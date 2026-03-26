import test from 'node:test'
import assert from 'node:assert/strict'
import { createSignedImageParams, verifySignedImageParams } from './signed-url'

test('verifySignedImageParams returns true for fresh valid signature', () => {
  const now = Date.now()
  const params = createSignedImageParams('secret-key', 'a.png', 600, now)
  const ok = verifySignedImageParams('secret-key', 'a.png', params.exp, params.sig, now)
  assert.equal(ok, true)
})

test('verifySignedImageParams returns false when expired', () => {
  const now = Date.now()
  const params = createSignedImageParams('secret-key', 'a.png', 1, now - 10_000)
  const ok = verifySignedImageParams('secret-key', 'a.png', params.exp, params.sig, now)
  assert.equal(ok, false)
})

test('verifySignedImageParams returns false for tampered filename', () => {
  const now = Date.now()
  const params = createSignedImageParams('secret-key', 'a.png', 600, now)
  const ok = verifySignedImageParams('secret-key', 'b.png', params.exp, params.sig, now)
  assert.equal(ok, false)
})
