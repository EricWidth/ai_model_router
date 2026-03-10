# 统一 API 接口实现文档

## 一、功能概述

统一 API 接口为 Agent 客户端提供统一的调用接口，兼容主流格式（如 OpenAI API 格式），支持文本对话、语音合成、图像生成等多种模型类型。

## 二、核心职责

1. 提供 OpenAI 兼容的 API 接口
2. 路由请求到合适的模型池
3. 统一请求和响应格式
4. 错误处理和转换
5. 身份验证和授权
6. 请求日志和监控

## 三、API 设计

### 3.1 业务 API

```
POST /v1/chat/completions      # 文本对话（兼容 OpenAI 格式）
POST /v1/audio/speech           # 语音合成
POST /v1/images/generations    # 文生图
POST /v1/audio/transcriptions   # 语音转文字（可选）
POST /v1/embeddings            # 文本嵌入（可选）
```

### 3.2 管理 API

```
GET /_internal/models          # 模型列表
POST /_internal/models          # 添加模型
PUT /_internal/models/:id      # 更新模型
DELETE /_internal/models/:id    # 删除模型
GET /_internal/stats           # 统计信息
GET /_internal/health          # 健康检查
```

## 四、数据结构

### 4.1 请求格式

#### Chat Completions Request

```typescript
interface ChatCompletionRequest {
  model?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    name?: string
  }>
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
}
```

#### Audio Speech Request

```typescript
interface AudioSpeechRequest {
  model?: string
  input: string
  voice: string
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  speed?: number
}
```

#### Image Generation Request

```typescript
interface ImageGenerationRequest {
  model?: string
  prompt: string
  n?: number
  size?: string
  quality?: string
}
```

### 4.2 响应格式

#### Chat Completions Response

```typescript
interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
```

#### Audio Speech Response

```typescript
type AudioSpeechResponse = Buffer
```

#### Image Generation Response

```typescript
interface ImageGenerationResponse {
  created: number
  data: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}
```

## 五、模块设计

### 5.1 目录结构

```
src/routes/
├── index.ts            # 路由注册
├── chat.ts             # 对话 API
├── audio.ts            # 语音 API
├── image.ts            # 图像 API
└── admin.ts            # 管理 API

src/middlewares/
├── auth.ts             # 身份验证
├── logger.ts           # 请求日志
├── cors.ts             # CORS 处理
└── error.ts            # 错误处理
```

### 5.2 路由实现

#### 聊天路由

```typescript
// src/routes/chat.ts
import express from 'express'
import { SwitchStrategy } from '../core/switch-strategy'
import { Metrics } from '../core/metrics'

const router = express.Router()

export function createChatRouter(
  switchStrategy: SwitchStrategy,
  metrics: Metrics
) {
  router.post('/completions', async (req, res) => {
    const startTime = Date.now()

    try {
      const request = req.body as ChatCompletionRequest

      if (!request.messages || !Array.isArray(request.messages)) {
        return res.status(400).json({
          error: {
            message: 'Missing or invalid messages field',
            type: 'invalid_request_error'
          }
        })
      }

      const response = await switchStrategy.execute('text', async (modelName) => {
        const adapter = getAdapter(modelName)
        const result = await adapter.chat(request)

        metrics.update('text', modelName, true)
        metrics.recordResponseTime('text', modelName, Date.now() - startTime)

        return result
      })

      res.json(response)
    } catch (error) {
      console.error('Chat completion error:', error)

      const duration = Date.now() - startTime
      if (req.body.messages) {
        const modelName = 'unknown'
        metrics.update('text', modelName, false)
        metrics.recordResponseTime('text', modelName, duration)
      }

      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'api_error'
        }
      })
    }
  })

  return router
}

function getAdapter(modelName: string): ModelAdapter {
}
```

#### 语音路由

```typescript
// src/routes/audio.ts
import express from 'express'

const router = express.Router()

export function createAudioRouter(
  switchStrategy: SwitchStrategy,
  metrics: Metrics
) {
  router.post('/speech', async (req, res) => {
    const startTime = Date.now()

    try {
      const request = req.body as AudioSpeechRequest

      const response = await switchStrategy.execute('voice', async (modelName) => {
        const adapter = getAdapter(modelName)
        const audioBuffer = await adapter.speech(request)

        metrics.update('voice', modelName, true)
        metrics.recordResponseTime('voice', modelName, Date.now() - startTime)

        return audioBuffer
      })

      res.set('Content-Type', 'audio/mpeg')
      res.send(response)
    } catch (error) {
      console.error('Speech synthesis error:', error)

      const duration = Date.now() - startTime
      if (req.body.input) {
        const modelName = 'unknown'
        metrics.update('voice', modelName, false)
        metrics.recordResponseTime('voice', modelName, duration)
      }

      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    }
  })

  return router
}
```

#### 图像路由

```typescript
// src/routes/image.ts
import express from 'express'

const router = express.Router()

export function createImageRouter(
  switchStrategy: SwitchStrategy,
  metrics: Metrics
) {
  router.post('/generations', async (req, res) => {
    const startTime = Date.now()

    try {
      const request = req.body as ImageGenerationRequest

      const response = await switchStrategy.execute('image', async (modelName) => {
        const adapter = getAdapter(modelName)
        const result = await adapter.image(request)

        metrics.update('image', modelName, true)
        metrics.recordResponseTime('image', modelName, Date.now() - startTime)

        return result
      })

      res.json(response)
    } catch (error) {
      console.error('Image generation error:', error)

      const duration = Date.now() - startTime
      if (req.body.prompt) {
        const modelName = 'unknown'
        metrics.update('image', modelName, false)
        metrics.recordResponseTime('image', modelName, duration)
      }

      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    }
  })

  return router
}
```

#### 管理路由

```typescript
// src/routes/admin.ts
import express from 'express'

const router = express.Router()

export function createAdminRouter(
  modelPool: ModelPool,
  metrics: Metrics,
  configManager: ConfigManager,
  authMiddleware: express.RequestHandler
) {
  router.get('/models', authMiddleware, (req, res) => {
    const stats = modelPool.getCurrentStats()

    const models = []
    for (const [type, pool] of stats.entries()) {
      for (const [name, state] of pool.entries()) {
        models.push({
          name,
          type,
          provider: state.provider,
          status: state.status,
          priority: state.priority,
          metrics: metrics.getModelMetrics(type, name)
        })
      }
    }

    res.json({ models })
  })

  router.post('/models', authMiddleware, async (req, res) => {
    try {
      const modelConfig = req.body as ModelConfig
      modelPool.addModel(modelConfig)
      res.status(201).json({ message: 'Model added successfully' })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  router.delete('/models/:name', authMiddleware, async (req, res) => {
    try {
      const { name } = req.params
      modelPool.removeModel(name)
      res.json({ message: 'Model removed successfully' })
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  })

  router.get('/stats', authMiddleware, (req, res) => {
    const overall = metrics.getOverallStats()
    const models = metrics.getMetrics()
    res.json({ overall, models })
  })

  router.get('/health', (req, res) => {
    const stats = modelPool.getCurrentStats()
    let availableCount = 0
    let totalCount = 0

    for (const pool of stats.values()) {
      for (const state of pool.values()) {
        totalCount++
        if (state.status === 'available') {
          availableCount++
        }
      }
    }

    res.json({
      status: availableCount > 0 ? 'healthy' : 'unhealthy',
      availableModels: availableCount,
      totalModels: totalCount
    })
  })

  return router
}
```

## 六、中间件实现

### 6.1 身份验证中间件

```typescript
// src/middlewares/auth.ts
import express from 'express'

export function createAuthMiddleware(apiKeys: string[]): express.RequestHandler {
  return (req, res, next) => {
    const authHeader = req.headers['authorization']

    if (!authHeader) {
      return res.status(401).json({
        error: {
          message: 'Missing Authorization header',
          type: 'authentication_error'
        }
      })
    }

    const token = authHeader.replace('Bearer ', '')

    if (!apiKeys.some(key => key === token)) {
      return res.status(401).json({
        error: {
          message: 'Invalid API key',
          type: 'authentication_error'
        }
      })
    }

    next()
  }
}
```

### 6.2 日志中间件

```typescript
// src/middlewares/logger.ts
import express from 'express'

export function createLoggerMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const startTime = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - startTime
      console.log(
        `${req.method} ${req.path} ${res.statusCode} - ${duration}ms`
      )
    })

    next()
  }
}
```

### 6.3 错误处理中间件

```typescript
// src/middlewares/error.ts
import express from 'express'

export function createErrorHandler(): express.ErrorRequestHandler {
  return (err, req, res, next) => {
    console.error('Unhandled error:', err)

    if (res.headersSent) {
      return next(err)
    }

    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'api_error'
      }
    })
  }
}
```

### 6.4 CORS 中间件

```typescript
// src/middlewares/cors.ts
import express from 'express'
import cors from 'cors'

export function createCorsMiddleware(options?: cors.CorsOptions): express.RequestHandler {
  return cors({
    origin: options?.origin || '*',
    methods: options?.methods || ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: options?.allowedHeaders || ['Content-Type', 'Authorization'],
    credentials: options?.credentials || false
  })
}
```

## 七、服务器启动

```typescript
// src/index.ts
import express from 'express'
import { ConfigManager } from './config'
import { ModelPool, SwitchStrategy, HealthCheck, Metrics } from './core'
import { createChatRouter, createAudioRouter, createImageRouter, createAdminRouter }
import { createAuthMiddleware, createLoggerMiddleware, createErrorHandler, createCorsMiddleware }
import { createAdapters } from './adapters/factory'

async function startServer() {
  const configManager = new ConfigManager('./config.yaml')
  const config = await configManager.load()

  const app = express()

  app.use(express.json())
  app.use(createCorsMiddleware({ cors: config.server.cors }))
  app.use(createLoggerMiddleware())

  const allModels = [
    ...config.models.text,
    ...config.models.voice,
    ...config.models.image
  ]

  const modelPool = new ModelPool(allModels, config.switch)
  const adapters = createAdapters(allModels)
  const switchStrategy = new SwitchStrategy(modelPool, config.switch)
  const metrics = new Metrics(modelPool)
  const healthCheck = new HealthCheck(modelPool, adapters, config.switch)

  healthCheck.start()

  const authMiddleware = createAuthMiddleware(config.apiKeys || [])

  app.use('/v1/chat', createChatRouter(switchStrategy, metrics))
  app.use('/v1/audio', createAudioRouter(switchStrategy, metrics))
  app.use('/v1/images', createImageRouter(switchStrategy, metrics))
  app.use('/_internal', createAdminRouter(modelPool, metrics, configManager, authMiddleware))

  app.use(createErrorHandler())

  app.listen(config.server.port, config.server.host, () => {
    console.log(`Server started on http://${config.server.host}:${config.server.port}`)
  })
}

startServer().catch(console.error)
```

## 八、使用示例

### 8.1 调用聊天接口

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ]
  }'
```

### 8.2 语音合成

```bash
curl -X POST http://localhost:8080/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Hello, world!",
    "voice": "alloy"
  }' \
  --output audio.mp3
```

### 8.3 图像生成

```bash
curl -X POST http://localhost:8080/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset",
    "n": 1,
    "size": "1024x1024"
  }'
```

## 九、测试用例

### 9.1 路由测试

```typescript
describe('Chat Router', () => {
  it('should handle chat completion request', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({
        messages: [{ role: 'user', content: 'Hello' }]
      })

    expect(response.status).toBe(200)
    expect(response.body.choices).toHaveLength(1)
  })

  it('should return 400 for invalid request', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({})

    expect(response.status).toBe(400)
  })
})
```

## 十、扩展点

1. **流式响应**: 支持 SSE 流式输出
2. **请求批处理**: 批量处理请求提高效率
3. **请求限流**: 防止 API 滥用
4. **缓存机制**: 缓存常见请求
5. **WebSocket 支持**: 实时双向通信
