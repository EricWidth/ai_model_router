import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWebSocketHandshakeRequest,
  encodeClientTextFrame,
  createServerFrameParser,
  normalizeWebSocketUrl
} from './openclaw-ws-client'

test('normalizeWebSocketUrl maps http urls to ws urls and appends api key', () => {
  const normalized = normalizeWebSocketUrl('http://127.0.0.1:8080/v1/tasks/openclaw/ws', 'secret-key')
  assert.equal(normalized, 'ws://127.0.0.1:8080/v1/tasks/openclaw/ws?api_key=secret-key')
})

test('createWebSocketHandshakeRequest includes required upgrade headers', () => {
  const request = createWebSocketHandshakeRequest(new URL('ws://127.0.0.1:8080/v1/tasks/openclaw/ws?api_key=secret'))

  assert.match(request, /^GET \/v1\/tasks\/openclaw\/ws\?api_key=secret HTTP\/1\.1\r\n/)
  assert.match(request, /Upgrade: websocket\r\n/)
  assert.match(request, /Sec-WebSocket-Key: /)
})

test('encodeClientTextFrame creates masked websocket frames', () => {
  const frame = encodeClientTextFrame('hello')

  assert.equal((frame[0] & 0x0f), 0x1)
  assert.equal((frame[1] & 0x80) !== 0, true)
})

test('createServerFrameParser decodes text frames and close frames', () => {
  const messages: string[] = []
  let closed = false
  const parser = createServerFrameParser(
    (message: string) => {
      messages.push(message)
    },
    () => {
      closed = true
    }
  )

  parser.push(Buffer.concat([Buffer.from([0x81, 0x05]), Buffer.from('hello')]))
  parser.push(Buffer.from([0x88, 0x00]))

  assert.deepEqual(messages, ['hello'])
  assert.equal(closed, true)
})
