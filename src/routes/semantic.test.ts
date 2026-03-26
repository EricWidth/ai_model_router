import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCategory } from './semantic'

test('detectCategory routes plain text input to llm by default', () => {
  const decision = detectCategory({
    input: '给我总结一下这个项目'
  })

  assert.equal(decision.category, 'llm')
})

test('detectCategory keeps vector for array embedding-shaped input', () => {
  const decision = detectCategory({
    input: ['doc1', 'doc2']
  })

  assert.equal(decision.category, 'vector')
})

test('detectCategory routes to vector when embedding fields are provided', () => {
  const decision = detectCategory({
    input: 'some text',
    encoding_format: 'float',
    dimensions: 1024
  })

  assert.equal(decision.category, 'vector')
})
