import test from 'node:test'
import assert from 'node:assert/strict'
import {
  connectJsonWebSocket,
  createMockOpenAIProvider,
  createSmokeConfigFile,
  startAmrProcess,
  waitForHealthyHttp
} from './test-helpers/openclaw-ws-smoke'

test('openclaw websocket smoke test streams chat chunks end-to-end', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18080,
    providerPort: provider.port,
    accessApiKey: 'smoke-key'
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18080/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18080/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_smoke',
        type: 'task.execute',
        data: {
          session: { key: 'agent:main:main' },
          action: 'chat',
          input: {
            text: 'hello',
            stream: true
          }
        }
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['task.chunk', 'task.completed']
    )
    assert.equal(messages[0]?.data?.body?.choices?.[0]?.delta?.content, 'smoke-hello')
    assert.equal(messages[1]?.data?.ok, true)
  } finally {
    await app.stop()
    await provider.close()
  }
})

test('openclaw websocket smoke test returns non-stream task.result for embeddings', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18081,
    providerPort: provider.port,
    accessApiKey: 'smoke-key'
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18081/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18081/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_embed',
        type: 'task.execute',
        data: {
          action: 'embed',
          input: {
            text: 'embed this text'
          }
        }
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['task.result']
    )
    assert.equal(messages[0]?.data?.responseType, 'json')
    assert.equal(messages[0]?.data?.body?.model, 'custom-model')
    assert.equal(Array.isArray(messages[0]?.data?.body?.data), true)
  } finally {
    await app.stop()
    await provider.close()
  }
})

test('openclaw websocket smoke test returns speech audio as base64', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18082,
    providerPort: provider.port,
    accessApiKey: 'smoke-key',
    includeVoiceModel: true
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18082/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18082/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_speech',
        type: 'task.execute',
        data: {
          action: 'generate',
          input: {
            text: 'hello audio',
            voice: 'alloy',
            response_format: 'mp3'
          },
          hints: {
            modality: 'audio',
            operation: 'speech'
          }
        }
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['task.result']
    )
    assert.equal(messages[0]?.data?.responseType, 'binary')
    assert.equal(messages[0]?.data?.contentType, 'audio/mpeg')
    assert.equal(Buffer.from(messages[0]?.data?.base64, 'base64').toString(), 'smoke-audio')
  } finally {
    await app.stop()
    await provider.close()
  }
})

test('openclaw websocket smoke test normalizes image generation b64 payloads into hosted urls', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18083,
    providerPort: provider.port,
    accessApiKey: 'smoke-key',
    includeVisualModel: true
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18083/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18083/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_image',
        type: 'task.execute',
        data: {
          action: 'generate',
          input: {
            prompt: 'draw a smoke test image',
            size: '1024x1024',
            n: 1
          },
          hints: {
            modality: 'image',
            operation: 'image_generation'
          }
        }
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['task.result']
    )
    assert.equal(messages[0]?.data?.responseType, 'json')
    const url = messages[0]?.data?.body?.data?.[0]?.url
    assert.equal(typeof url, 'string')
    assert.match(url, /^http:\/\/127\.0\.0\.1:18083\/_generated\/images\//)
  } finally {
    await app.stop()
    await provider.close()
  }
})

test('openclaw websocket smoke test resolves payloads without executing providers', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18084,
    providerPort: provider.port,
    accessApiKey: 'smoke-key'
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18084/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18084/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_resolve',
        type: 'task.resolve',
        data: {
          session: { key: 'agent:resolve:main' },
          action: 'chat',
          input: {
            text: 'hello',
            attachments: [
              {
                type: 'image_url',
                url: 'https://example.com/smoke.png'
              }
            ]
          }
        }
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['task.resolved']
    )
    assert.equal(messages[0]?.data?.sessionKey, 'agent:resolve:main')
    assert.equal(messages[0]?.data?.gatewayTask?.hints?.routeCategory, 'multimodal')
    assert.equal(messages[0]?.data?.task?.taskType, 'chat')
  } finally {
    await app.stop()
    await provider.close()
  }
})

test('openclaw websocket smoke test responds to ping with pong', async () => {
  const provider = await createMockOpenAIProvider()
  const configPath = await createSmokeConfigFile({
    amrPort: 18085,
    providerPort: provider.port,
    accessApiKey: 'smoke-key'
  })
  const app = startAmrProcess(configPath)

  try {
    await waitForHealthyHttp('http://127.0.0.1:18085/v1/models', 'smoke-key')
    const messages = await connectJsonWebSocket(
      'ws://127.0.0.1:18085/v1/tasks/openclaw/ws',
      'smoke-key',
      {
        id: 'req_ping',
        type: 'ping',
        data: {}
      }
    )

    assert.deepEqual(
      messages.map((message: { type: string }) => message.type),
      ['pong']
    )
    assert.equal(messages[0]?.id, 'req_ping')
    assert.equal(typeof messages[0]?.data?.timestamp, 'number')
  } finally {
    await app.stop()
    await provider.close()
  }
})
