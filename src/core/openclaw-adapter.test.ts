import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOpenClawRequest } from './openclaw-adapter'

test('normalizeOpenClawRequest maps chat messages into a gateway chat task', () => {
  const task = normalizeOpenClawRequest({
    session: { key: 'agent:main:main' },
    action: 'chat',
    input: {
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    }
  })

  assert.equal(task.sessionKey, 'agent:main:main')
  assert.equal(task.task, 'chat')
  assert.equal(Array.isArray(task.input.messages), true)
  assert.equal(task.input.stream, true)
})

test('normalizeOpenClawRequest maps audio generation hints into a speech task', () => {
  const task = normalizeOpenClawRequest({
    sessionKey: 'agent:tts',
    action: 'generate',
    input: {
      text: 'read this aloud',
      voice: 'alloy'
    },
    hints: {
      modality: 'audio',
      operation: 'speech'
    }
  })

  assert.equal(task.sessionKey, 'agent:tts')
  assert.equal(task.task, 'speech')
  assert.equal(task.input.input, 'read this aloud')
  assert.equal(task.input.voice, 'alloy')
})

test('normalizeOpenClawRequest maps image attachments into multimodal chat hints', () => {
  const task = normalizeOpenClawRequest({
    action: 'chat',
    input: {
      text: 'describe this image',
      attachments: [{ type: 'image_url', url: 'https://example.com/cat.png' }]
    }
  })

  assert.equal(task.task, 'chat')
  assert.equal(task.hints?.routeCategory, 'multimodal')
  const messages = task.input.messages as Array<{ content: unknown }>
  assert.equal(Array.isArray(messages), true)
  assert.equal(Array.isArray(messages[0]?.content), true)
})

test('normalizeOpenClawRequest maps embed action into an embedding task', () => {
  const task = normalizeOpenClawRequest({
    action: 'embed',
    input: {
      text: 'embed this text'
    }
  })

  assert.equal(task.task, 'embed')
  assert.equal(task.input.input, 'embed this text')
})
