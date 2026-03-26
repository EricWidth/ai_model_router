import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import net from 'node:net'
import tls from 'node:tls'
import {
  createServerFrameParser,
  createWebSocketHandshakeRequest,
  encodeClientTextFrame,
  normalizeWebSocketUrl
} from '../core/openclaw-ws-client'

export interface SmokeMessage {
  id?: string
  type: string
  data?: any
}

export async function createMockOpenAIProvider(): Promise<{
  port: number
  close(): Promise<void>
}> {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('method not allowed')
      return
    }

    if (req.url === '/chat/completions') {
      const body = await readJsonBody(req)
      if (body?.stream === true) {
        const serialized = JSON.stringify(body)
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.flushHeaders()
        const content = serialized.includes('hold-open')
          ? `smoke-hello-${'x'.repeat(8192)}`
          : 'smoke-hello'
        res.write(`data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`)
        if (serialized.includes('hold-open')) {
          await sleep(3000)
        }
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        id: 'chatcmpl-smoke',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'smoke-hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }))
      return
    }

    if (req.url === '/embeddings') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 }
      }))
      return
    }

    if (req.url === '/audio/speech') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.end(Buffer.from('smoke-audio'))
      return
    }

    if (req.url === '/images/generations') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: Buffer.from('smoke-image').toString('base64') }]
      }))
      return
    }

    res.statusCode = 404
    res.end('not found')
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve mock provider port')
  }

  return {
    port: address.port,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}

export async function createSmokeConfigFile(options: {
  amrPort: number
  providerPort: number
  accessApiKey: string
  includeVoiceModel?: boolean
  includeVectorModel?: boolean
  includeVisualModel?: boolean
}): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-openclaw-ws-smoke-'))
  const configPath = path.join(tempDir, 'config.yaml')
  const visualModels = options.includeVisualModel
    ? `  visual:
    - name: gpt-image-1
      provider: openai
      apiKey: smoke-provider-key
      baseUrl: http://127.0.0.1:${options.providerPort}
      priority: 1
`
    : '  visual: []\n'
  const voiceModels = options.includeVoiceModel
    ? `  voice:
    - name: tts-1
      provider: openai
      apiKey: smoke-provider-key
      baseUrl: http://127.0.0.1:${options.providerPort}
      priority: 1
`
    : '  voice: []\n'
  const vectorModels = options.includeVectorModel === false
    ? '  vector: []\n'
    : `  vector:
    - name: text-embedding-3-small
      provider: openai
      apiKey: smoke-provider-key
      baseUrl: http://127.0.0.1:${options.providerPort}
      priority: 1
`
  const yaml = `server:
  port: ${options.amrPort}
  host: 127.0.0.1
  accessApiKey: ${options.accessApiKey}
  publicModelName: custom-model
models:
  llm:
    - name: gpt-4o-mini
      provider: openai
      apiKey: smoke-provider-key
      baseUrl: http://127.0.0.1:${options.providerPort}
      priority: 1
${visualModels}  multimodal: []
${voiceModels}${vectorModels}switch:
  maxRetries: 1
  cooldown: 1000
  healthCheckInterval: 0
`
  await fs.writeFile(configPath, yaml, 'utf8')
  return configPath
}

export function startAmrProcess(configPath: string): {
  stop(): Promise<void>
} {
  const child = spawn('node', ['dist/src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AMR_CONFIG: configPath,
      AMR_ENV_FILE: path.join(os.tmpdir(), 'amr-smoke-empty.env')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let exited = false
  const logs: string[] = []
  child.stdout?.on('data', (chunk) => {
    logs.push(String(chunk))
  })
  child.stderr?.on('data', (chunk) => {
    logs.push(String(chunk))
  })
  child.on('exit', () => {
    exited = true
  })

  return {
    stop() {
      if (exited) return Promise.resolve()
      child.kill('SIGTERM')
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
        }, 3000)
        child.once('exit', (code) => {
          clearTimeout(timer)
          if (code === null || code === 0 || code === 143) {
            resolve()
            return
          }
          reject(new Error(`AMR exited unexpectedly: ${code}\n${logs.join('')}`))
        })
      })
    }
  }
}

export async function waitForHealthyHttp(url: string, apiKey: string): Promise<void> {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (response.ok) return
    } catch {
      // retry
    }
    await sleep(200)
  }

  throw new Error(`Timed out waiting for HTTP readiness: ${url}`)
}

export async function connectJsonWebSocket(
  rawUrl: string,
  apiKey: string | undefined,
  message: Record<string, unknown>
): Promise<SmokeMessage[]> {
  const normalized = new URL(normalizeWebSocketUrl(rawUrl, apiKey))
  const socket = connect(normalized)
  const messages: SmokeMessage[] = []

  await waitForWebSocketHandshake(socket, normalized)

  await new Promise<SmokeMessage[]>((resolve, reject) => {
    let settled = false
    const finish = (result: SmokeMessage[]) => {
      if (settled) return
      settled = true
      socket.removeAllListeners('data')
      socket.removeAllListeners('error')
      socket.end()
      socket.destroy()
      resolve(result)
    }
    const parser = createServerFrameParser(
      (payload) => {
        const parsed = JSON.parse(payload) as SmokeMessage
        messages.push(parsed)
        if (
          parsed.type === 'task.completed' ||
          parsed.type === 'task.result' ||
          parsed.type === 'task.resolved' ||
          parsed.type === 'pong' ||
          parsed.type === 'task.error'
        ) {
          finish(messages)
        }
      },
      () => {
        finish(messages)
      }
    )

    socket.on('data', (chunk) => {
      parser.push(chunk)
    })
    socket.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    socket.write(encodeClientTextFrame(JSON.stringify(message)))
  })

  return messages
}

function connect(url: URL): net.Socket | tls.TLSSocket {
  if (url.protocol === 'wss:') {
    return tls.connect({
      host: url.hostname,
      port: url.port ? Number(url.port) : 443,
      rejectUnauthorized: false
    })
  }

  return net.connect({
    host: url.hostname,
    port: url.port ? Number(url.port) : 80
  })
}

function waitForWebSocketHandshake(socket: net.Socket | tls.TLSSocket, url: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const boundary = buffer.indexOf('\r\n\r\n')
      if (boundary < 0) return

      socket.off('data', onData)
      const headers = buffer.subarray(0, boundary).toString('utf8')
      const remainder = buffer.subarray(boundary + 4)
      if (!headers.startsWith('HTTP/1.1 101')) {
        reject(new Error(`WebSocket handshake failed for ${url.toString()}: ${headers.split('\r\n')[0]}`))
        return
      }
      if (remainder.length > 0) {
        socket.unshift(remainder)
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

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
