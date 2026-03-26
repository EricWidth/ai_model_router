import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeGatewayTask } from './gateway-task-executor'
import { GatewayTaskRequest } from './unified-task'
import { AppContext } from '../routes/context'

test('executeGatewayTask runs embedding tasks against vector models', async () => {
  const request: GatewayTaskRequest = {
    task: 'embed',
    input: {
      input: 'embed this text'
    }
  }

  const ctx = createTestContext({
    embeddings: async () => ({
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
      model: 'vector-model',
      usage: { prompt_tokens: 3, total_tokens: 3 }
    })
  })

  const result = await executeGatewayTask(ctx, request)

  assert.equal(result.task.taskType, 'embeddings')
  assert.equal(result.modelName, 'vector-model')
  assert.equal(result.responseType, 'json')
  assert.equal((result.body as { model: string }).model, 'custom-model')
})

test('executeGatewayTask runs speech tasks against voice models', async () => {
  const request: GatewayTaskRequest = {
    task: 'speech',
    input: {
      input: 'read this aloud',
      voice: 'alloy'
    }
  }

  const ctx = createTestContext({
    speech: async () => Buffer.from('audio-bytes')
  })

  const result = await executeGatewayTask(ctx, request)

  assert.equal(result.task.taskType, 'speech')
  assert.equal(result.modelName, 'voice-model')
  assert.equal(result.responseType, 'binary')
  assert.equal(result.contentType, 'audio/mpeg')
  assert.equal((result.body as Buffer).toString(), 'audio-bytes')
})

test('executeGatewayTask runs image generation tasks against visual models', async () => {
  const request: GatewayTaskRequest = {
    task: 'generate',
    input: {
      prompt: 'draw a cat',
      size: '1024x1024'
    },
    hints: {
      modality: 'image'
    }
  }

  const ctx = createTestContext({
    image: async () => ({
      created: 1,
      data: [{ url: 'https://example.com/cat.png' }]
    })
  })

  const result = await executeGatewayTask(ctx, request)

  assert.equal(result.task.taskType, 'image_generation')
  assert.equal(result.modelName, 'visual-model')
  assert.equal(result.responseType, 'json')
  assert.equal((result.body as { data: Array<{ url?: string }> }).data[0]?.url, 'https://example.com/cat.png')
})

test('executeGatewayTask normalizes b64 image payloads when request context is provided', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-gateway-task-image-'))
  const request: GatewayTaskRequest = {
    task: 'generate',
    input: {
      prompt: 'draw a cat',
      size: '1024x1024'
    },
    hints: {
      modality: 'image'
    }
  }

  const ctx = createTestContext({
    image: async () => ({
      created: 1,
      data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }]
    })
  })

  const result = await executeGatewayTask(ctx, request, {
    req: createReqMock('127.0.0.1:8080'),
    imageOptions: { outputDir }
  })

  const url = (result.body as { data: Array<{ url?: string }> }).data[0]?.url
  assert.ok(typeof url === 'string' && url.startsWith('http://127.0.0.1:8080/_generated/images/'))
})

test('executeGatewayTask returns upstream stream response for chat tasks with stream enabled', async () => {
  const request: GatewayTaskRequest = {
    task: 'chat',
    input: {
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    }
  }

  const streamResponse = new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' }
  })

  const ctx = createTestContext({
    chatStream: async () => streamResponse
  })

  const result = await executeGatewayTask(ctx, request)

  assert.equal(result.task.taskType, 'chat')
  assert.equal(result.responseType, 'stream')
  assert.equal(result.contentType, 'text/event-stream; charset=utf-8')
  assert.equal(result.body, streamResponse)
})

function createTestContext(overrides: {
  embeddings?: () => Promise<unknown>
  speech?: () => Promise<Buffer>
  image?: () => Promise<unknown>
  chatStream?: () => Promise<Response>
}): AppContext {
  const config = {
    server: {
      port: 8080,
      host: '127.0.0.1',
      publicModelName: 'custom-model'
    },
    models: {
      llm: [{ name: 'llm-model', provider: 'test', apiKey: 'x', priority: 1 }],
      visual: [{ name: 'visual-model', provider: 'test', apiKey: 'x', priority: 1 }],
      multimodal: [{ name: 'mm-model', provider: 'test', apiKey: 'x', priority: 1 }],
      voice: [{ name: 'voice-model', provider: 'test', apiKey: 'x', priority: 1 }],
      vector: [{ name: 'vector-model', provider: 'test', apiKey: 'x', priority: 1 }]
    },
    switch: {
      maxRetries: 1,
      cooldown: 1000,
      healthCheckInterval: 0
    }
  }

  return {
    configPath: 'test-config.yaml',
    config,
    modelPool: {
      addTokenUsage() {},
      listStates() {
        return {
          llm: [],
          visual: [],
          multimodal: [],
          voice: [],
          vector: []
        }
      }
    } as any,
    metrics: {
      update() {}
    } as any,
    switchStrategy: {
      async execute(type: string, executor: (modelName: string) => Promise<unknown>) {
        const modelName =
          type === 'vector' ? 'vector-model' : type === 'voice' ? 'voice-model' : type === 'visual' ? 'visual-model' : 'llm-model'
        return {
          modelName,
          result: await executor(modelName)
        }
      }
    } as any,
    adapterRegistry: {
      get(modelName: string) {
        return {
          embeddings: overrides.embeddings ?? (async () => ({ object: 'list', data: [], model: modelName })),
          speech: overrides.speech ?? (async () => Buffer.from('')),
          image: overrides.image ?? (async () => ({ created: Date.now(), data: [] })),
          chat: async () => ({
            id: '1',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
          }),
          chatStream: overrides.chatStream ?? (async () => new Response()),
          healthCheck: async () => {},
          getType: () => 'llm',
          name: modelName,
          provider: 'test'
        }
      }
    } as any,
    runtimeEvents: {
      emit() {}
    } as any
  }
}

function createReqMock(host = 'localhost:8080') {
  return {
    protocol: 'http',
    get(name: string): string | undefined {
      if (name.toLowerCase() === 'host') return host
      return undefined
    }
  } as any
}
