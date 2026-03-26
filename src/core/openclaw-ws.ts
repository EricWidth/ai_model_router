import { createHash } from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { Duplex } from 'node:stream'
import { createUnifiedTaskFromGatewayRequest } from './unified-task'
import { executeGatewayTask } from './gateway-task-executor'
import { normalizeOpenClawRequest } from './openclaw-adapter'
import { AppContext } from '../routes/context'

interface OpenClawWsEnvelope {
  id?: string
  type?: string
  data?: Record<string, unknown>
}

interface OpenClawWsTransport {
  send(message: Record<string, unknown>): void
  close(code?: number, reason?: string): void
}

interface OpenClawWsExecutionContext {
  req?: {
    protocol: string
    get(name: string): string | undefined
  }
}

export function isAuthorizedWebSocketRequest(req: IncomingMessage, apiKey?: string): boolean {
  if (!apiKey) return true

  const authorization = headerValue(req, 'authorization')
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined
  const headerToken = headerValue(req, 'x-api-key')?.trim()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const queryToken = url.searchParams.get('api_key') ?? url.searchParams.get('access_token') ?? undefined

  return bearerToken === apiKey || headerToken === apiKey || queryToken === apiKey
}

export function createOpenClawWsSession(
  ctx: AppContext,
  transport: OpenClawWsTransport,
  executionContext: OpenClawWsExecutionContext = {}
) {
  let closed = false
  const activeStreams = new Map<string, { cancel: () => Promise<void> | void; cancelled: boolean }>()

  const send = (message: Record<string, unknown>) => {
    if (closed) return
    transport.send(message)
  }

  const cancelActiveStream = async (requestId: string, notify: boolean): Promise<boolean> => {
    const active = activeStreams.get(requestId)
    if (!active || active.cancelled) return false
    active.cancelled = true
    await active.cancel()
    activeStreams.delete(requestId)
    if (notify) {
      send({
        type: 'task.cancelled',
        data: {
          requestId
        }
      })
    }
    return true
  }

  return {
    async handleMessage(rawMessage: string): Promise<void> {
      let envelope: OpenClawWsEnvelope
      try {
        envelope = JSON.parse(rawMessage) as OpenClawWsEnvelope
      } catch {
        send({
          type: 'task.error',
          data: { error: { message: 'Invalid JSON message' } }
        })
        return
      }

      const id = typeof envelope.id === 'string' ? envelope.id : undefined
      const type = typeof envelope.type === 'string' ? envelope.type : undefined
      const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : undefined

      if (type === 'ping') {
        send({ ...(id ? { id } : {}), type: 'pong', data: { timestamp: Date.now() } })
        return
      }

      if (!type || !data) {
        send({
          ...(id ? { id } : {}),
          type: 'task.error',
          data: { error: { message: 'Invalid WebSocket message envelope' } }
        })
        return
      }

      if (type === 'task.cancel') {
        const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
        if (!requestId) {
          send({
            ...(id ? { id } : {}),
            type: 'task.error',
            data: { error: { message: 'Missing requestId for task.cancel' } }
          })
          return
        }

        const cancelled = await cancelActiveStream(requestId, false)
        if (!cancelled) {
          send({
            ...(id ? { id } : {}),
            type: 'task.error',
            data: { error: { message: `No active cancellable task for requestId: ${requestId}` } }
          })
          return
        }

        send({
          ...(id ? { id } : {}),
          type: 'task.cancelled',
          data: { requestId }
        })
        return
      }

      if (type === 'task.resolve') {
        const gatewayTask = normalizeOpenClawRequest(data)
        send({
          ...(id ? { id } : {}),
          type: 'task.resolved',
          data: {
            sessionKey: gatewayTask.sessionKey ?? null,
            gatewayTask,
            task: createUnifiedTaskFromGatewayRequest(gatewayTask)
          }
        })
        return
      }

      if (type !== 'task.execute') {
        send({
          ...(id ? { id } : {}),
          type: 'task.error',
          data: { error: { message: `Unsupported message type: ${type}` } }
        })
        return
      }

      try {
        const request = normalizeOpenClawRequest(data)
        const result = await executeGatewayTask(ctx, request, {
          req: executionContext.req as never,
          imageOptions: {
            publicBaseUrl: ctx.config.server.publicBaseUrl,
            signedUrlSecret: ctx.config.server.accessApiKey
          }
        })

        if (result.responseType === 'stream') {
          const upstream = result.body as Response
          if (!upstream.body) {
            send({
              ...(id ? { id } : {}),
              type: 'task.completed',
              data: { ok: true }
            })
            return
          }

          const reader = upstream.body.getReader()
          if (id) {
            activeStreams.set(id, {
              cancelled: false,
              cancel: async () => {
                await reader.cancel()
              }
            })
          }

          let completed = false
          try {
            for await (const event of iterateSseEvents(reader)) {
              if (id && activeStreams.get(id)?.cancelled) {
                break
              }

              if (event.data === '[DONE]') {
                send({
                  ...(id ? { id } : {}),
                  type: 'task.completed',
                  data: { ok: true }
                })
                completed = true
                break
              }

              send({
                ...(id ? { id } : {}),
                type: 'task.chunk',
                data: {
                  event: event.event,
                  body: tryParseJson(event.data),
                  raw: event.data
                }
              })
            }
          } catch {
            // Stream cancellation closes the body reader; suppress transport errors here.
          } finally {
            if (id) {
              const wasCancelled = activeStreams.get(id)?.cancelled === true
              activeStreams.delete(id)
              if (wasCancelled) {
                return
              }
            }
          }

          if (!completed) {
            send({
              ...(id ? { id } : {}),
              type: 'task.completed',
              data: { ok: true }
            })
          }
          return
        }

        if (result.responseType === 'binary') {
          send({
            ...(id ? { id } : {}),
            type: 'task.result',
            data: {
              responseType: 'binary',
              contentType: result.contentType,
              base64: (result.body as Buffer).toString('base64')
            }
          })
          return
        }

        send({
          ...(id ? { id } : {}),
          type: 'task.result',
          data: {
            responseType: result.responseType,
            contentType: result.contentType,
            body: result.body
          }
        })
      } catch (error) {
        send({
          ...(id ? { id } : {}),
          type: 'task.error',
          data: {
            error: {
              message: error instanceof Error ? error.message : String(error)
            }
          }
        })
      }
    },
    close() {
      if (closed) return
      closed = true
      for (const [requestId, active] of activeStreams.entries()) {
        active.cancelled = true
        void active.cancel()
        activeStreams.delete(requestId)
      }
    }
  }
}

export function handleOpenClawWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: AppContext,
  apiKey?: string
): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/v1/tasks/openclaw/ws') {
    return false
  }

  if (!isAuthorizedWebSocketRequest(req, apiKey)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return true
  }

  const upgrade = headerValue(req, 'upgrade')
  const key = headerValue(req, 'sec-websocket-key')
  if (upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return true
  }

  const acceptKey = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  )

  const transport = createSocketTransport(socket)
  const session = createOpenClawWsSession(ctx, transport, {
    req: {
      protocol: url.protocol === 'wss:' ? 'https' : 'http',
      get(name: string) {
        if (name.toLowerCase() === 'host') return headerValue(req, 'host')
        return undefined
      }
    }
  })
  const parser = createWebSocketFrameParser(async (payload) => {
    await session.handleMessage(payload)
  }, () => {
    session.close()
    socket.end()
  })

  socket.on('data', (chunk) => {
    parser.push(chunk)
  })
  socket.on('error', () => {
    session.close()
    socket.destroy()
  })

  if (head.length > 0) {
    parser.push(head)
  }

  return true
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

function createSocketTransport(socket: Duplex): OpenClawWsTransport {
  return {
    send(message) {
      const payload = Buffer.from(JSON.stringify(message))
      socket.write(encodeTextFrame(payload))
    },
    close(code = 1000) {
      const closeFrame = Buffer.allocUnsafe(4)
      closeFrame.writeUInt8(0x88, 0)
      closeFrame.writeUInt8(0x02, 1)
      closeFrame.writeUInt16BE(code, 2)
      socket.write(closeFrame)
      socket.end()
    }
  }
}

function encodeTextFrame(payload: Buffer): Buffer {
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  }

  if (payload.length < 65536) {
    const header = Buffer.allocUnsafe(4)
    header.writeUInt8(0x81, 0)
    header.writeUInt8(126, 1)
    header.writeUInt16BE(payload.length, 2)
    return Buffer.concat([header, payload])
  }

  const header = Buffer.allocUnsafe(10)
  header.writeUInt8(0x81, 0)
  header.writeUInt8(127, 1)
  header.writeBigUInt64BE(BigInt(payload.length), 2)
  return Buffer.concat([header, payload])
}

function createWebSocketFrameParser(
  onTextMessage: (payload: string) => Promise<void>,
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

        const masked = (second & 0x80) !== 0
        const maskBytes = masked ? 4 : 0
        if (buffer.length < offset + maskBytes + length) return

        let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + length)
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4)
          const decoded = Buffer.allocUnsafe(length)
          for (let index = 0; index < length; index += 1) {
            decoded[index] = payload[index] ^ mask[index % 4]
          }
          payload = decoded
        }

        buffer = buffer.subarray(offset + maskBytes + length)

        if (opcode === 0x8) {
          onClose()
          return
        }

        if (opcode === 0x9) {
          continue
        }

        if (opcode === 0x1) {
          void onTextMessage(payload.toString('utf8'))
        }
      }
    }
  }
}

async function* iterateSseEvents(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseSseEvent(block)
      if (event) yield event
      boundary = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  const trailing = parseSseEvent(buffer)
  if (trailing) yield trailing
  reader.releaseLock()
}

function parseSseEvent(block: string): { event: string; data: string } | null {
  const lines = block
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith(':'))

  if (lines.length === 0) return null

  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message'
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
