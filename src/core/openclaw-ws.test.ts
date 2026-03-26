import test from 'node:test'
import assert from 'node:assert/strict'
import { AppContext } from '../routes/context'
import { createOpenClawWsSession, isAuthorizedWebSocketRequest } from './openclaw-ws'

test('isAuthorizedWebSocketRequest accepts bearer token and query token', () => {
  const bearerReq = createUpgradeRequest({
    authorization: 'Bearer secret-key'
  })
  assert.equal(isAuthorizedWebSocketRequest(bearerReq, 'secret-key'), true)

  const queryReq = createUpgradeRequest({}, '/v1/tasks/openclaw/ws?api_key=secret-key')
  assert.equal(isAuthorizedWebSocketRequest(queryReq, 'secret-key'), true)
  assert.equal(isAuthorizedWebSocketRequest(createUpgradeRequest(), 'secret-key'), false)
})

test('openclaw ws session resolves payloads into gateway and unified tasks', async () => {
  const sent: Array<Record<string, unknown>> = []
  const session = createOpenClawWsSession(createTestContext(), {
    send(message: Record<string, unknown>) {
      sent.push(message)
    },
    close() {}
  })

  await session.handleMessage(JSON.stringify({
    id: 'req_resolve',
    type: 'task.resolve',
    data: {
      session: { key: 'agent:main:main' },
      action: 'chat',
      input: {
        text: 'hello'
      }
    }
  }))

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.type, 'task.resolved')
  assert.equal((sent[0]?.data as { gatewayTask?: { sessionKey?: string } }).gatewayTask?.sessionKey, 'agent:main:main')
  assert.equal((sent[0]?.data as { task?: { taskType?: string } }).task?.taskType, 'chat')
})

test('openclaw ws session executes non-stream tasks and returns task.result', async () => {
  const sent: Array<Record<string, unknown>> = []
  const session = createOpenClawWsSession(createTestContext(), {
    send(message: Record<string, unknown>) {
      sent.push(message)
    },
    close() {}
  })

  await session.handleMessage(JSON.stringify({
    id: 'req_embed',
    type: 'task.execute',
    data: {
      action: 'embed',
      input: {
        text: 'embed this text'
      }
    }
  }))

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.type, 'task.result')
  assert.equal((sent[0]?.data as { responseType?: string }).responseType, 'json')
  assert.equal((sent[0]?.data as { body?: { model?: string } }).body?.model, 'custom-model')
})

test('openclaw ws session converts streamed chat SSE into chunk and completed messages', async () => {
  const sent: Array<Record<string, unknown>> = []
  const session = createOpenClawWsSession(createTestContext({
    chatStream: async () => new Response(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\nevent: message\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
    )
  }), {
    send(message: Record<string, unknown>) {
      sent.push(message)
    },
    close() {}
  })

  await session.handleMessage(JSON.stringify({
    id: 'req_stream',
    type: 'task.execute',
    data: {
      action: 'chat',
      input: {
        text: 'hello',
        stream: true
      }
    }
  }))

  assert.deepEqual(
    sent.map((item) => item.type),
    ['task.chunk', 'task.chunk', 'task.completed']
  )
  assert.equal((sent[0]?.data as { body?: { choices?: Array<{ delta?: { content?: string } }> } }).body?.choices?.[0]?.delta?.content, 'hello')
  assert.equal((sent[2]?.data as { ok?: boolean }).ok, true)
})

test('openclaw ws session cancels active streamed chat requests', async () => {
  const sent: Array<Record<string, unknown>> = []
  const gate = createGate()
  const streamResponse = new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'))
        await gate.wait()
        controller.enqueue(Buffer.from('data: [DONE]\n\n'))
        controller.close()
      },
      cancel() {
        gate.open()
      }
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
  )

  const session = createOpenClawWsSession(createTestContext({
    chatStream: async () => streamResponse
  }), {
    send(message: Record<string, unknown>) {
      sent.push(message)
    },
    close() {}
  })

  const running = session.handleMessage(JSON.stringify({
    id: 'req_stream',
    type: 'task.execute',
    data: {
      action: 'chat',
      input: {
        text: 'hello',
        stream: true
      }
    }
  }))

  await waitFor(() => sent.some((message) => message.type === 'task.chunk'))

  await session.handleMessage(JSON.stringify({
    id: 'cancel_1',
    type: 'task.cancel',
    data: {
      requestId: 'req_stream'
    }
  }))
  await running

  assert.deepEqual(
    sent.map((item) => item.type),
    ['task.chunk', 'task.cancelled']
  )
  assert.equal((sent[1]?.data as { requestId?: string }).requestId, 'req_stream')
})

test('openclaw ws session closes active streams on session close', async () => {
  const sent: Array<Record<string, unknown>> = []
  const gate = createGate()
  const streamResponse = new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'))
        await gate.wait()
        controller.enqueue(Buffer.from('data: [DONE]\n\n'))
        controller.close()
      },
      cancel() {
        gate.open()
      }
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
  )

  const session = createOpenClawWsSession(createTestContext({
    chatStream: async () => streamResponse
  }), {
    send(message: Record<string, unknown>) {
      sent.push(message)
    },
    close() {}
  })

  const running = session.handleMessage(JSON.stringify({
    id: 'req_stream',
    type: 'task.execute',
    data: {
      action: 'chat',
      input: {
        text: 'hello',
        stream: true
      }
    }
  }))

  await waitFor(() => sent.some((message) => message.type === 'task.chunk'))
  session.close()
  await running

  assert.deepEqual(
    sent.map((item) => item.type),
    ['task.chunk']
  )
})

function createTestContext(overrides: {
  chatStream?: () => Promise<Response>
} = {}): AppContext {
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
    },
    modelPool: {
      addTokenUsage() {},
      listStates() {
        return { llm: [], visual: [], multimodal: [], voice: [], vector: [] }
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
          embeddings: async () => ({
            object: 'list',
            data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
            model: modelName,
            usage: { prompt_tokens: 3, total_tokens: 3 }
          }),
          speech: async () => Buffer.from('audio'),
          image: async () => ({ created: Date.now(), data: [{ url: 'https://example.com/image.png' }] }),
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

function createUpgradeRequest(headers: Record<string, string> = {}, url = '/v1/tasks/openclaw/ws') {
  return {
    headers,
    url
  } as any
}

function createGate() {
  let opened = false
  let resolvePromise: (() => void) | undefined
  return {
    wait() {
      if (opened) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolvePromise = resolve
      })
    },
    open() {
      if (opened) return
      opened = true
      resolvePromise?.()
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}
