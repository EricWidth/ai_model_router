#!/usr/bin/env node

const net = require('node:net')
const tls = require('node:tls')
const {
  normalizeWebSocketUrl,
  createWebSocketHandshakeRequest,
  encodeClientTextFrame,
  createServerFrameParser
} = require('../dist/src/core/openclaw-ws-client.js')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.url || !options.payload) {
    printUsage()
    process.exit(1)
  }

  const url = new URL(normalizeWebSocketUrl(options.url, options.apiKey))
  const socket = connect(url)

  await waitForHandshake(socket, url)

  const parser = createServerFrameParser((message) => {
    try {
      console.log(JSON.stringify(JSON.parse(message), null, 2))
    } catch {
      console.log(message)
    }
  }, () => {
    socket.end()
  })

  socket.on('data', (chunk) => {
    parser.push(chunk)
  })

  const payload = loadPayload(options.payload)
  const envelope = {
    id: options.id || `req_${Date.now()}`,
    type: options.type || 'task.execute',
    data: payload
  }
  socket.write(encodeClientTextFrame(JSON.stringify(envelope)))
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if ((arg === '--url' || arg === '-u') && next) {
      options.url = next
      index += 1
      continue
    }
    if ((arg === '--api-key' || arg === '-k') && next) {
      options.apiKey = next
      index += 1
      continue
    }
    if ((arg === '--payload' || arg === '-p') && next) {
      options.payload = next
      index += 1
      continue
    }
    if ((arg === '--type' || arg === '-t') && next) {
      options.type = next
      index += 1
      continue
    }
    if (arg === '--id' && next) {
      options.id = next
      index += 1
    }
  }
  return options
}

function printUsage() {
  console.error('Usage: node scripts/openclaw_ws_client.js --url <ws-url> --payload <json-or-file> [--api-key <key>] [--type task.execute]')
}

function loadPayload(rawPayload) {
  if (rawPayload.trim().startsWith('{')) {
    return JSON.parse(rawPayload)
  }

  const fs = require('node:fs')
  const content = fs.readFileSync(rawPayload, 'utf8')
  return JSON.parse(content)
}

function connect(url) {
  if (url.protocol === 'wss:') {
    return tls.connect({
      host: url.hostname,
      port: url.port ? Number(url.port) : 443
    })
  }

  return net.connect({
    host: url.hostname,
    port: url.port ? Number(url.port) : 80
  })
}

function waitForHandshake(socket, url) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const boundary = buffer.indexOf('\r\n\r\n')
      if (boundary < 0) return

      socket.off('data', onData)
      const headerBlock = buffer.slice(0, boundary)
      const remainder = buffer.slice(boundary + 4)

      if (!headerBlock.startsWith('HTTP/1.1 101')) {
        reject(new Error(`WebSocket handshake failed for ${url.toString()}: ${headerBlock.split('\r\n')[0]}`))
        return
      }

      if (remainder.length > 0) {
        socket.unshift(Buffer.from(remainder, 'utf8'))
      }
      resolve()
    }

    socket.once('error', reject)
    socket.on('data', onData)
    socket.once('connect', () => {
      socket.write(createWebSocketHandshakeRequest(url))
    })
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
