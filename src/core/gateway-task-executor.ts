import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  ImageGenerationRequest,
  ImageGenerationResponse
} from '../types'
import { Request } from 'express'
import { AppContext } from '../routes/context'
import { markModelSelected } from '../routes/model-selection'
import { createUnifiedTaskFromGatewayRequest, GatewayTaskRequest, UnifiedTask } from './unified-task'
import { normalizeImageGenerationResponse } from '../routes/image-normalizer'

interface GatewayTaskExecutionOptions {
  req?: Request
  imageOptions?: {
    outputDir?: string
    publicBaseUrl?: string
    signedUrlSecret?: string
    signedUrlTtlSeconds?: number
  }
}

export interface GatewayTaskExecutionResult {
  task: UnifiedTask
  modelName: string
  responseType: 'json' | 'binary' | 'stream'
  contentType: string
  body: ChatCompletionResponse | EmbeddingsResponse | ImageGenerationResponse | Buffer | Response
}

export async function executeGatewayTask(
  ctx: AppContext,
  request: GatewayTaskRequest,
  options: GatewayTaskExecutionOptions = {}
): Promise<GatewayTaskExecutionResult> {
  const task = createUnifiedTaskFromGatewayRequest(request)
  const started = Date.now()

  if (task.taskType === 'embeddings') {
    const embeddingsRequest = toEmbeddingsRequest(request.input)
    const { modelName, result } = await ctx.switchStrategy.execute('vector', async (candidate) => {
      const adapter = ctx.adapterRegistry.get(candidate)
      return adapter.embeddings(embeddingsRequest)
    })
    markModelSelected(ctx, 'vector', modelName)
    ctx.metrics.update('vector', modelName, true, Date.now() - started, toEmbeddingTokens(result))
    ctx.runtimeEvents.emit('gateway.task.completed', {
      taskType: task.taskType,
      routeCategory: task.routeCategory,
      modelName,
      sessionKey: request.sessionKey
    })
    return {
      task,
      modelName,
      responseType: 'json',
      contentType: 'application/json; charset=utf-8',
      body: normalizeEmbeddingsResponse(result, ctx.config.server.publicModelName || 'custom-model')
    }
  }

  if (task.taskType === 'speech') {
    const speechRequest = toSpeechRequest(request.input)
    const { modelName, result } = await ctx.switchStrategy.execute('voice', async (candidate) => {
      const adapter = ctx.adapterRegistry.get(candidate)
      return adapter.speech(speechRequest)
    })
    markModelSelected(ctx, 'voice', modelName)
    ctx.metrics.update('voice', modelName, true, Date.now() - started, 0)
    ctx.runtimeEvents.emit('gateway.task.completed', {
      taskType: task.taskType,
      routeCategory: task.routeCategory,
      modelName,
      sessionKey: request.sessionKey
    })
    return {
      task,
      modelName,
      responseType: 'binary',
      contentType: 'audio/mpeg',
      body: result
    }
  }

  if (task.taskType === 'image_generation') {
    const imageRequest = toImageGenerationRequest(request.input)
    const { modelName, result } = await ctx.switchStrategy.execute('visual', async (candidate) => {
      const adapter = ctx.adapterRegistry.get(candidate)
      return adapter.image(imageRequest)
    })
    markModelSelected(ctx, 'visual', modelName)
    const normalized =
      options.req
        ? await normalizeImageGenerationResponse(result, options.req, {
            outputDir: options.imageOptions?.outputDir,
            publicBaseUrl: options.imageOptions?.publicBaseUrl ?? ctx.config.server.publicBaseUrl,
            signedUrlSecret: options.imageOptions?.signedUrlSecret ?? ctx.config.server.accessApiKey,
            signedUrlTtlSeconds: options.imageOptions?.signedUrlTtlSeconds
          })
        : result
    ctx.metrics.update('visual', modelName, true, Date.now() - started, 0)
    ctx.runtimeEvents.emit('gateway.task.completed', {
      taskType: task.taskType,
      routeCategory: task.routeCategory,
      modelName,
      sessionKey: request.sessionKey
    })
    return {
      task,
      modelName,
      responseType: 'json',
      contentType: 'application/json; charset=utf-8',
      body: normalized
    }
  }

  const chatRequest = toChatRequest(request.input)
  const modelType = task.routeCategory === 'multimodal' ? 'multimodal' : 'llm'
  if (chatRequest.stream !== false) {
    const { modelName, result } = await ctx.switchStrategy.execute(modelType, async (candidate) => {
      const adapter = ctx.adapterRegistry.get(candidate)
      return adapter.chatStream(chatRequest)
    })
    markModelSelected(ctx, modelType, modelName)
    ctx.metrics.update(modelType, modelName, true, Date.now() - started, 0)
    ctx.runtimeEvents.emit('gateway.task.completed', {
      taskType: task.taskType,
      routeCategory: task.routeCategory,
      modelName,
      sessionKey: request.sessionKey,
      stream: true
    })
    return {
      task,
      modelName,
      responseType: 'stream',
      contentType: result.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      body: result
    }
  }

  const { modelName, result } = await ctx.switchStrategy.execute(modelType, async (candidate) => {
    const adapter = ctx.adapterRegistry.get(candidate)
    return adapter.chat(chatRequest)
  })
  markModelSelected(ctx, modelType, modelName)
  const normalized = normalizeChatResponse(result, ctx.config.server.publicModelName || 'custom-model')
  ctx.metrics.update(modelType, modelName, true, Date.now() - started, normalized.usage?.total_tokens ?? 0)
  ctx.runtimeEvents.emit('gateway.task.completed', {
    taskType: task.taskType,
    routeCategory: task.routeCategory,
    modelName,
    sessionKey: request.sessionKey
  })
  return {
    task,
    modelName,
    responseType: 'json',
    contentType: 'application/json; charset=utf-8',
    body: normalized
  }
}

function toImageGenerationRequest(input: Record<string, unknown>): ImageGenerationRequest {
  return {
    model: typeof input.model === 'string' ? input.model : undefined,
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    n: toPositiveInt(input.n),
    size: typeof input.size === 'string' ? input.size : undefined,
    quality: typeof input.quality === 'string' ? input.quality : undefined
  }
}

function toEmbeddingsRequest(input: Record<string, unknown>): EmbeddingsRequest {
  return {
    model: typeof input.model === 'string' ? input.model : undefined,
    input: input.input as EmbeddingsRequest['input'],
    encoding_format: input.encoding_format === 'base64' ? 'base64' : 'float',
    dimensions: toPositiveInt(input.dimensions),
    user: typeof input.user === 'string' ? input.user : undefined
  }
}

function toSpeechRequest(input: Record<string, unknown>) {
  return {
    model: typeof input.model === 'string' ? input.model : undefined,
    input: typeof input.input === 'string' ? input.input : '',
    voice: typeof input.voice === 'string' ? input.voice : 'alloy',
    response_format: isSpeechFormat(input.response_format) ? input.response_format : undefined,
    speed: typeof input.speed === 'number' ? input.speed : undefined
  }
}

function toChatRequest(input: Record<string, unknown>): ChatCompletionRequest {
  const messages = Array.isArray(input.messages) ? input.messages : []
  if (messages.length > 0) {
    return input as unknown as ChatCompletionRequest
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt : typeof input.input === 'string' ? input.input : ''
  return {
    ...(input as Record<string, unknown>),
    messages: prompt ? [{ role: 'user', content: prompt }] : []
  } as ChatCompletionRequest
}

function normalizeChatResponse(result: ChatCompletionResponse, publicModelName: string): ChatCompletionResponse {
  return {
    ...result,
    model: publicModelName
  }
}

function normalizeEmbeddingsResponse(result: EmbeddingsResponse, publicModelName: string): EmbeddingsResponse {
  return {
    ...result,
    model: publicModelName
  }
}

function toEmbeddingTokens(result: EmbeddingsResponse): number {
  const total = Number(result.usage?.total_tokens ?? 0)
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const intValue = Math.floor(parsed)
  if (intValue < 1) return undefined
  return intValue
}

function isSpeechFormat(value: unknown): value is 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' {
  return value === 'mp3' || value === 'opus' || value === 'aac' || value === 'flac' || value === 'wav' || value === 'pcm'
}
