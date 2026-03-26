import test from 'node:test'
import assert from 'node:assert/strict'
import { generatedImageAuth } from './generated-image-auth'

function createResMock() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.payload = body
      return this
    }
  }
}

test('generatedImageAuth returns 400 for malformed encoded path instead of throwing', () => {
  const middleware = generatedImageAuth('secret')
  const req = {
    path: '/%E0%A4%A',
    query: {},
    header: () => undefined
  } as any
  const res = createResMock()
  let nextCalled = false

  assert.doesNotThrow(() => {
    middleware(req, res as any, () => {
      nextCalled = true
    })
  })

  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.payload, {
    error: {
      message: 'Invalid image path',
      type: 'invalid_request_error',
      param: null,
      code: null
    }
  })
})
