import { randomBytes } from 'node:crypto'

export function normalizeWebSocketUrl(rawUrl: string, apiKey?: string): string {
  const url = new URL(rawUrl)
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }

  if (apiKey && !url.searchParams.has('api_key') && !url.searchParams.has('access_token')) {
    url.searchParams.set('api_key', apiKey)
  }

  return url.toString()
}

export function createWebSocketHandshakeRequest(url: URL): string {
  const key = randomBytes(16).toString('base64')
  const path = `${url.pathname}${url.search}`
  return (
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${url.host}\r\n` +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Key: ${key}\r\n` +
    'Sec-WebSocket-Version: 13\r\n' +
    '\r\n'
  )
}

export function encodeClientTextFrame(message: string): Buffer {
  const payload = Buffer.from(message)
  const mask = randomBytes(4)
  let header: Buffer

  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length])
  } else if (payload.length < 65536) {
    header = Buffer.allocUnsafe(4)
    header.writeUInt8(0x81, 0)
    header.writeUInt8(0x80 | 126, 1)
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header.writeUInt8(0x81, 0)
    header.writeUInt8(0x80 | 127, 1)
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  const maskedPayload = Buffer.allocUnsafe(payload.length)
  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4]
  }

  return Buffer.concat([header, mask, maskedPayload])
}

export function createServerFrameParser(
  onMessage: (message: string) => void,
  onClose: () => void
) {
  let buffer = Buffer.alloc(0)

  return {
    push(chunk: Buffer) {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= 2) {
        const first = buffer[0]
        const second = buffer[1]
        const opcode = first & 0x0f
        let offset = 2
        let length = second & 0x7f

        if (length === 126) {
          if (buffer.length < offset + 2) return
          length = buffer.readUInt16BE(offset)
          offset += 2
        } else if (length === 127) {
          if (buffer.length < offset + 8) return
          const longLength = buffer.readBigUInt64BE(offset)
          if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            onClose()
            return
          }
          length = Number(longLength)
          offset += 8
        }

        if (buffer.length < offset + length) return
        const payload = buffer.subarray(offset, offset + length)
        buffer = buffer.subarray(offset + length)

        if (opcode === 0x8) {
          onClose()
          return
        }

        if (opcode === 0x1) {
          onMessage(payload.toString('utf8'))
        }
      }
    }
  }
}
