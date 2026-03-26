import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldProbeState } from './index'

test('shouldProbeState only probes chat-capable categories when blocked', () => {
  assert.equal(shouldProbeState('llm', 'cooling'), true)
  assert.equal(shouldProbeState('multimodal', 'unavailable'), true)
  assert.equal(shouldProbeState('visual', 'cooling'), false)
  assert.equal(shouldProbeState('voice', 'unavailable'), false)
  assert.equal(shouldProbeState('vector', 'cooling'), false)
})

test('shouldProbeState never probes available or quota-exhausted states', () => {
  assert.equal(shouldProbeState('llm', 'available'), false)
  assert.equal(shouldProbeState('llm', 'quota_exhausted'), false)
  assert.equal(shouldProbeState('multimodal', 'available'), false)
})
