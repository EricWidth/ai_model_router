import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatRouter, resolveChatRouteDecision } from './chat'
import { AppContext } from './context'

test('resolveChatRouteDecision keeps llm when no image payload exists', () => {
  const decision = resolveChatRouteDecision('llm', {
    messages: [{ role: 'user', content: 'hello' }]
  } as any)
  assert.equal(decision.modelType, 'llm')
  assert.equal(decision.error, undefined)
  assert.equal(decision.semanticDecision.category, 'llm')
})

test('resolveChatRouteDecision upgrades llm to multimodal when image payload exists', () => {
  const decision = resolveChatRouteDecision('llm', {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read text from image' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }
        ]
      }
    ]
  } as any)
  assert.equal(decision.modelType, 'multimodal')
  assert.equal(decision.error, undefined)
  assert.equal(decision.semanticDecision.category, 'multimodal')
})

test('resolveChatRouteDecision keeps multimodal unchanged', () => {
  const decision = resolveChatRouteDecision('multimodal', {
    messages: [{ role: 'user', content: 'hello' }]
  } as any)
  assert.equal(decision.modelType, 'multimodal')
})

test('resolveChatRouteDecision returns endpoint hint for vector-like requests', () => {
  const decision = resolveChatRouteDecision('llm', {
    messages: [{ role: 'user', content: 'hello' }],
    input: ['a', 'b'],
    encoding_format: 'float'
  } as any)
  assert.equal(decision.modelType, 'llm')
  assert.ok(decision.error?.includes('/v1/embeddings'))
  assert.equal(decision.semanticDecision.category, 'vector')
})

test('resolveChatRouteDecision returns endpoint hint for voice-like requests', () => {
  const decision = resolveChatRouteDecision('llm', {
    messages: [{ role: 'user', content: 'hello' }],
    voice: 'alloy'
  } as any)
  assert.equal(decision.modelType, 'llm')
  assert.ok(decision.error?.includes('/v1/audio/speech'))
  assert.equal(decision.semanticDecision.category, 'voice')
})

test('resolveChatRouteDecision keeps visual-style requests on llm chat path', () => {
  const decision = resolveChatRouteDecision('llm', {
    messages: [{ role: 'user', content: 'draw a cat' }],
    prompt: 'draw a cat',
    size: '1024x1024'
  } as any)
  assert.equal(decision.modelType, 'llm')
  assert.equal(decision.error, undefined)
  assert.equal(decision.semanticDecision.category, 'visual')
})

test('createChatRouter routes image-bearing chat requests through multimodal and sets semantic headers', async () => {
  const executions: string[] = []
  const router = createChatRouter(createChatRouteTestContext(executions))
  const handler = router.stack[0]?.route?.stack[0]?.handle as Function
  const res = createResponseMock()

  await handler({
    body: {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }
          ]
        }
      ],
      stream: false
    }
  }, res, (error?: unknown) => {
    if (error) throw error
  })

  assert.deepEqual(executions, ['multimodal'])
  assert.equal(res.headers['x-semantic-category'], 'multimodal')
  assert.equal(typeof res.headers['x-semantic-confidence'], 'string')
  assert.equal(res.jsonBody?.model, 'custom-model')
})

function createChatRouteTestContext(executions: string[]): AppContext {
  return {
    configPath: 'test-config.yaml',
    config: {
      server: {
        port: 8080,
        host: '127.0.0.1',
        publicModelName: 'custom-model'
      },
      models: {
        llm: [{ name: 'llm-model', provider: 'test', apiKey: 'x', priority: 1 }],
        visual: [],
        multimodal: [{ name: 'mm-model', provider: 'test', apiKey: 'x', priority: 1 }],
        voice: [],
        vector: []
      },
      switch: {
        maxRetries: 1,
        cooldown: 1000,
        healthCheckInterval: 0
      }
    } as any,
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
        executions.push(type)
        return {
          modelName: type === 'multimodal' ? 'mm-model' : 'llm-model',
          result: await executor(type === 'multimodal' ? 'mm-model' : 'llm-model')
        }
      }
    } as any,
    adapterRegistry: {
      get(modelName: string) {
        return {
          chat: async () => ({
            id: '1',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          chatStream: async () => new Response(),
          consumeLearnedMaxTokens: () => undefined
        }
      }
    } as any,
    runtimeEvents: {
      emit() {}
    } as any
  }
}

function createResponseMock() {
  const headers: Record<string, string> = {}
  return {
    headers,
    jsonBody: undefined as any,
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value
      return this
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    once() {
      return this
    },
    json(body: unknown) {
      this.jsonBody = body
      return this
    }
  }
}
