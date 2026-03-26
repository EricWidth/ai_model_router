import test from 'node:test'
import assert from 'node:assert/strict'
import { createUnifiedTask, createUnifiedTaskFromGatewayRequest } from './unified-task'

test('createUnifiedTask maps llm category to chat task', () => {
  const task = createUnifiedTask('llm', {
    messages: [{ role: 'user', content: 'hello' }]
  })

  assert.equal(task.taskType, 'chat')
  assert.equal(task.routeCategory, 'llm')
  assert.equal(task.stream, true)
})

test('createUnifiedTask maps vector category to embeddings task', () => {
  const task = createUnifiedTask('vector', {
    input: 'embed this text'
  })

  assert.equal(task.taskType, 'embeddings')
  assert.equal(task.routeCategory, 'vector')
})

test('createUnifiedTask maps voice category to speech task', () => {
  const task = createUnifiedTask('voice', {
    input: 'read this aloud',
    voice: 'alloy'
  })

  assert.equal(task.taskType, 'speech')
  assert.equal(task.routeCategory, 'voice')
})

test('createUnifiedTask maps visual generation requests to image generation task', () => {
  const task = createUnifiedTask('visual', {
    prompt: 'draw a cat',
    size: '1024x1024'
  })

  assert.equal(task.taskType, 'image_generation')
  assert.equal(task.routeCategory, 'visual')
})

test('createUnifiedTask maps non-generation visual requests to chat task', () => {
  const task = createUnifiedTask('visual', {
    messages: [{ role: 'user', content: '识别图片里的文字' }]
  })

  assert.equal(task.taskType, 'chat')
  assert.equal(task.routeCategory, 'visual')
})

test('createUnifiedTaskFromGatewayRequest respects explicit route category for chat tasks', () => {
  const task = createUnifiedTaskFromGatewayRequest({
    task: 'chat',
    input: {
      messages: [{ role: 'user', content: 'describe this image' }]
    },
    hints: {
      routeCategory: 'multimodal'
    }
  })

  assert.equal(task.taskType, 'chat')
  assert.equal(task.routeCategory, 'multimodal')
  assert.equal(task.stream, true)
})

test('createUnifiedTaskFromGatewayRequest derives speech task from gateway hints', () => {
  const task = createUnifiedTaskFromGatewayRequest({
    task: 'generate',
    input: {
      input: 'read this aloud',
      voice: 'alloy'
    },
    hints: {
      modality: 'audio',
      operation: 'speech'
    }
  })

  assert.equal(task.taskType, 'speech')
  assert.equal(task.routeCategory, 'voice')
})

test('createUnifiedTaskFromGatewayRequest derives image generation from gateway hints', () => {
  const task = createUnifiedTaskFromGatewayRequest({
    task: 'generate',
    input: {
      prompt: 'draw a cat',
      size: '1024x1024'
    },
    hints: {
      modality: 'image'
    }
  })

  assert.equal(task.taskType, 'image_generation')
  assert.equal(task.routeCategory, 'visual')
})
