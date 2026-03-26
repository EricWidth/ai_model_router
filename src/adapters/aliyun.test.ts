import test from 'node:test'
import assert from 'node:assert/strict'
import { AliyunAdapter } from './aliyun'

test('AliyunAdapter applies default max_tokens for llm chat payload', () => {
  const adapter = new AliyunAdapter('qwen-plus', 'aliyun', 'test-key', 'https://example.com', 30000)
  const payload = (adapter as any).buildChatPayload(
    {
      messages: [{ role: 'user', content: 'hello' }]
    },
    false
  )

  assert.equal(typeof payload.max_tokens, 'number')
  assert.ok(payload.max_tokens > 0)
})

test('AliyunAdapter does not apply default max_tokens for visual models', () => {
  const adapter = new AliyunAdapter('wanx-v1', 'aliyun', 'test-key', 'https://example.com', 30000)
  const payload = (adapter as any).buildChatPayload(
    {
      messages: [{ role: 'user', content: 'hello' }]
    },
    false
  )

  assert.equal(payload.max_tokens, undefined)
})
