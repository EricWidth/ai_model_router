import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldProbeState } from './index'

test('shouldProbeState probes blocked states for all model categories', () => {
  assert.equal(shouldProbeState('llm', 'cooling'), true)
  assert.equal(shouldProbeState('multimodal', 'unavailable'), true)
  assert.equal(shouldProbeState('visual', 'cooling'), true)
  assert.equal(shouldProbeState('voice', 'unavailable'), true)
  assert.equal(shouldProbeState('vector', 'cooling'), true)
})

test('shouldProbeState never probes available or quota-exhausted states', () => {
  assert.equal(shouldProbeState('llm', 'available'), false)
  assert.equal(shouldProbeState('llm', 'quota_exhausted'), false)
  assert.equal(shouldProbeState('multimodal', 'available'), false)
})
