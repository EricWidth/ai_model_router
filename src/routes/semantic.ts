import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { Request, Response, Router } from 'express'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { markModelSelected } from './model-selection'
import {
  ModelType,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  AudioSpeechRequest,
  ImageGenerationRequest
} from '../types'
import { isQuotaExhausted, demoteModelToLowestPriority } from '../core/quota-policy'
import { saveConfigToFile } from '../config/storage'
import { logger } from '../utils/logger'
import { normalizeImageGenerationResponse } from './image-normalizer'
import { createUnifiedTask } from '../core/unified-task'

type SemanticCategory = ModelType

export interface SemanticDecision {
  category: SemanticCategory
  confidence: number
  reason: string
}

export function createSemanticRouter(ctx: AppContext): Router {
  const router = Router()

  router.post('/semantic', async (req, res, next) => {
    const started = Date.now()
    const body = (req.body ?? {}) as Record<string, unknown>
    const decision = detectCategory(body)
    const task = createUnifiedTask(decision.category, body)

    try {
      if (task.taskType === 'embeddings') {
        await handleVector(ctx, body, decision, started, res)
        return
      }

      if (task.taskType === 'speech') {
        await handleVoice(ctx, body, decision, started, res)
        return
      }

      if (task.taskType === 'image_generation') {
        await handleImageGeneration(ctx, body, decision, started, req, res)
        return
      }

      await handleChatLike(ctx, body, decision, started, res)
    } catch (error) {
      ctx.metrics.update(decision.category, 'unknown', false, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'semantic',
        modelType: decision.category,
        modelName: 'unknown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
      next(error)
    }
  })

  return router
}

async function handleChatLike(
  ctx: AppContext,
  body: Record<string, unknown>,
  decision: SemanticDecision,
  started: number,
  res: Response
): Promise<void> {
  const request = toChatRequest(body)
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    sendOpenAIError(res, 400, 'Invalid messages', 'invalid_request_error')
    return
  }

  const wantsStream = request.stream !== false
  if (wantsStream) {
    const { modelName, result: upstream } = await ctx.switchStrategy.execute(decision.category, async (modelName) => {
      const adapter = ctx.adapterRegistry.get(modelName)
      return adapter.chatStream(request)
    })
    persistLearnedMaxTokensIfNeeded(ctx, decision.category, modelName)
    markModelSelected(ctx, decision.category, modelName)
    setSemanticHeaders(res, decision)
    let streamTotalTokens = 0
    let streamedText = ''
    let completedEventSent = false
    const emitCompleted = (success: boolean, errorMessage?: string) => {
      if (completedEventSent) return
      completedEventSent = true
      if (success && streamTotalTokens <= 0) {
        const estimated = estimateTokenUsage(request.messages, streamedText)
        streamTotalTokens = estimated.total_tokens
      }
      if (success && streamTotalTokens > 0) {
        ctx.modelPool.addTokenUsage(decision.category, modelName, streamTotalTokens)
        persistQuotaDemotionIfNeeded(ctx, decision.category, modelName)
      }
      ctx.metrics.update(decision.category, modelName, success, Date.now() - started, streamTotalTokens)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'semantic',
        modelType: decision.category,
        modelName,
        success,
        stream: true,
        tokens: streamTotalTokens,
        semantic: decision,
        ...(errorMessage ? { error: errorMessage } : {})
      })
    }

    res.once('finish', () => {
      emitCompleted(true)
    })
    res.once('close', () => {
      emitCompleted(res.writableEnded)
    })

    try {
      await pipeUpstreamStream(
        upstream,
        res,
        (totalTokens) => {
          streamTotalTokens = totalTokens
        },
        (deltaText) => {
          if (deltaText) streamedText += deltaText
        }
      )
    } catch (streamError) {
      emitCompleted(false, streamError instanceof Error ? streamError.message : String(streamError))
      throw streamError
    }
    return
  }

  const { modelName, result } = await ctx.switchStrategy.execute(decision.category, async (modelName) => {
    const adapter = ctx.adapterRegistry.get(modelName)
    return adapter.chat(request)
  })
  persistLearnedMaxTokensIfNeeded(ctx, decision.category, modelName)
  markModelSelected(ctx, decision.category, modelName)

  let tokenCount = Number((result as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0)
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
    const completionText = collectCompletionText(result as unknown as Record<string, unknown>)
    const estimated = estimateTokenUsage(request.messages, completionText)
    tokenCount = estimated.total_tokens
  }
  const normalized = normalizeSemanticChatResponse(result as ChatCompletionResponse, ctx.config.server.publicModelName || 'custom-model')
  if (tokenCount > 0) {
    ctx.modelPool.addTokenUsage(decision.category, modelName, tokenCount)
    persistQuotaDemotionIfNeeded(ctx, decision.category, modelName)
  }
  ctx.metrics.update(decision.category, modelName, true, Date.now() - started, Math.max(0, tokenCount))
  ctx.runtimeEvents.emit('request.completed', {
    route: 'semantic',
    modelType: decision.category,
    modelName,
    success: true,
    semantic: decision
  })

  setSemanticHeaders(res, decision)
  res.json({
    ...normalized,
    semantic_routing: {
      category: decision.category,
      confidence: decision.confidence,
      reason: decision.reason
    }
  })
}

async function handleVector(
  ctx: AppContext,
  body: Record<string, unknown>,
  decision: SemanticDecision,
  started: number,
  res: Response
): Promise<void> {
  const input = body.input
  if (!hasEmbeddingInput(input)) {
    sendOpenAIError(res, 400, 'Invalid input', 'invalid_request_error', 'input')
    return
  }

  const request: EmbeddingsRequest = {
    model: typeof body.model === 'string' ? body.model : undefined,
    input: input as EmbeddingsRequest['input'],
    encoding_format: body.encoding_format === 'base64' ? 'base64' : 'float',
    dimensions: toPositiveInt(body.dimensions),
    user: typeof body.user === 'string' ? body.user : undefined
  }

  const { modelName, result } = await ctx.switchStrategy.execute('vector', async (modelName) => {
    const adapter = ctx.adapterRegistry.get(modelName)
    return adapter.embeddings(request)
  })
  markModelSelected(ctx, 'vector', modelName)
  setSemanticHeaders(res, decision)

  let tokenCount = Number((result as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0)
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
    tokenCount = estimateEmbeddingTokens(request.input)
  }
  if (tokenCount > 0) {
    ctx.modelPool.addTokenUsage('vector', modelName, tokenCount)
    persistQuotaDemotionIfNeeded(ctx, 'vector', modelName)
  }
  ctx.metrics.update('vector', modelName, true, Date.now() - started, Math.max(0, tokenCount))
  ctx.runtimeEvents.emit('request.completed', {
    route: 'semantic',
    modelType: 'vector',
    modelName,
    success: true,
    semantic: decision
  })

  res.json({
    ...normalizeEmbeddingsResponse(result as EmbeddingsResponse, ctx.config.server.publicModelName || 'custom-model'),
    semantic_routing: {
      category: decision.category,
      confidence: decision.confidence,
      reason: decision.reason
    }
  })
}

async function handleVoice(
  ctx: AppContext,
  body: Record<string, unknown>,
  decision: SemanticDecision,
  started: number,
  res: Response
): Promise<void> {
  const input = typeof body.input === 'string' ? body.input : ''
  const voice = typeof body.voice === 'string' ? body.voice : ''
  if (!input || !voice) {
    sendOpenAIError(res, 400, 'Invalid speech request', 'invalid_request_error')
    return
  }

  const request: AudioSpeechRequest = {
    model: typeof body.model === 'string' ? body.model : undefined,
    input,
    voice,
    response_format: isSpeechFormat(body.response_format) ? body.response_format : undefined,
    speed: typeof body.speed === 'number' ? body.speed : undefined
  }

  const { modelName, result: buffer } = await ctx.switchStrategy.execute('voice', async (modelName) => {
    const adapter = ctx.adapterRegistry.get(modelName)
    return adapter.speech(request)
  })
  markModelSelected(ctx, 'voice', modelName)

  ctx.metrics.update('voice', modelName, true, Date.now() - started, 0)
  ctx.runtimeEvents.emit('request.completed', {
    route: 'semantic',
    modelType: 'voice',
    modelName,
    success: true,
    semantic: decision
  })
  res.set('Content-Type', 'audio/mpeg')
  setSemanticHeaders(res, decision)
  res.send(buffer)
}

async function handleImageGeneration(
  ctx: AppContext,
  body: Record<string, unknown>,
  decision: SemanticDecision,
  started: number,
  req: Request,
  res: Response
): Promise<void> {
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (!prompt) {
    sendOpenAIError(res, 400, 'Missing prompt', 'invalid_request_error', 'prompt')
    return
  }

  const request: ImageGenerationRequest = {
    model: typeof body.model === 'string' ? body.model : undefined,
    prompt,
    n: toPositiveInt(body.n),
    size: typeof body.size === 'string' ? body.size : undefined,
    quality: typeof body.quality === 'string' ? body.quality : undefined
  }

  const { modelName, result } = await ctx.switchStrategy.execute('visual', async (modelName) => {
    const adapter = ctx.adapterRegistry.get(modelName)
    return adapter.image(request)
  })
  markModelSelected(ctx, 'visual', modelName)
  const normalized = await normalizeImageGenerationResponse(result, req, {
    publicBaseUrl: ctx.config.server.publicBaseUrl,
    signedUrlSecret: ctx.config.server.accessApiKey
  })

  ctx.metrics.update('visual', modelName, true, Date.now() - started, 0)
  ctx.runtimeEvents.emit('request.completed', {
    route: 'semantic',
    modelType: 'visual',
    modelName,
    success: true,
    semantic: decision
  })
  setSemanticHeaders(res, decision)
  res.json({
    ...normalized,
    semantic_routing: {
      category: decision.category,
      confidence: decision.confidence,
      reason: decision.reason
    }
  })
}

export function detectCategory(body: Record<string, unknown>): SemanticDecision {
  const explicit = toCategory(body.category) ?? toCategory(body.modelType) ?? toCategory(body.taskCategory)
  if (explicit) {
    return { category: explicit, confidence: 1, reason: 'explicit category hint provided' }
  }

  if (isEmbeddingShapedInput(body) && !hasImagePayload(body) && !hasAudioPayload(body)) {
    return { category: 'vector', confidence: 0.95, reason: 'embedding-shaped input detected' }
  }

  if (hasAudioPayload(body)) {
    return { category: 'voice', confidence: 0.95, reason: 'audio/speech fields detected' }
  }

  if (shouldRouteToImageGeneration(body)) {
    return { category: 'visual', confidence: 0.9, reason: 'image generation fields detected' }
  }

  const hasImage = hasImagePayload(body)
  const text = collectText(body).toLowerCase()
  if (hasImage) {
    if (matchesAny(text, ['绘图', '生成图片', 'image generation', 'generate image'])) {
      return { category: 'visual', confidence: 0.8, reason: 'image generation semantics detected' }
    }
    return { category: 'multimodal', confidence: 0.88, reason: 'image payload detected for multimodal reasoning' }
  }

  if (matchesAny(text, ['向量', 'embedding', 'embeddings', '向量化', '检索向量'])) {
    return { category: 'vector', confidence: 0.75, reason: 'vector semantics detected' }
  }
  if (matchesAny(text, ['语音', '朗读', 'tts', 'asr', 'transcribe', 'speech'])) {
    return { category: 'voice', confidence: 0.75, reason: 'voice semantics detected' }
  }
  if (matchesAny(text, ['识别图片', '看图', '图像', 'ocr', 'image', '图片'])) {
    return { category: 'visual', confidence: 0.7, reason: 'visual semantics detected' }
  }

  return { category: 'llm', confidence: 0.6, reason: 'default fallback to llm' }
}

function toCategory(value: unknown): SemanticCategory | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'llm' || normalized === 'visual' || normalized === 'multimodal' || normalized === 'voice' || normalized === 'vector') {
    return normalized
  }
  return undefined
}

function hasAudioPayload(body: Record<string, unknown>): boolean {
  return (
    typeof body.voice === 'string' ||
    typeof body.audio === 'string' ||
    typeof body.audio_url === 'string' ||
    typeof body.response_format === 'string' ||
    typeof body.speed === 'number'
  )
}

function hasEmbeddingInput(input: unknown): boolean {
  if (typeof input === 'string') return input.trim().length > 0
  return Array.isArray(input) && input.length > 0
}

function isEmbeddingShapedInput(body: Record<string, unknown>): boolean {
  const input = body.input
  if (!hasEmbeddingInput(input)) return false

  if (Array.isArray(input)) {
    return true
  }

  const hasEmbeddingFieldHints =
    typeof body.encoding_format === 'string' || Number.isFinite(Number(body.dimensions)) || typeof body.user === 'string'
  if (hasEmbeddingFieldHints) {
    return true
  }

  const text = collectText(body).toLowerCase()
  return matchesAny(text, ['向量', 'embedding', 'embeddings', '向量化', '检索向量'])
}

function hasImagePayload(body: Record<string, unknown>): boolean {
  if (typeof body.image === 'string' || typeof body.image_url === 'string') return true
  const messages = body.messages
  if (!Array.isArray(messages)) return false

  return messages.some((msg) => {
    if (!msg || typeof msg !== 'object') return false
    const content = (msg as { content?: unknown }).content
    if (typeof content === 'string') return false
    if (!Array.isArray(content)) return false
    return content.some((item) => {
      if (!item || typeof item !== 'object') return false
      const obj = item as Record<string, unknown>
      const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : ''
      return (
        type.includes('image') ||
        typeof obj.image_url === 'string' ||
        typeof obj.image === 'string' ||
        (obj.image_url && typeof obj.image_url === 'object')
      )
    })
  })
}

function shouldRouteToImageGeneration(body: Record<string, unknown>): boolean {
  const hasPrompt = typeof body.prompt === 'string' && body.prompt.trim().length > 0
  const hasGenerationHint =
    typeof body.size === 'string' ||
    typeof body.quality === 'string' ||
    typeof body.n === 'number' ||
    (typeof body.task === 'string' && body.task.toLowerCase().includes('image_generation'))
  return hasPrompt && hasGenerationHint
}

function collectText(body: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof body.prompt === 'string') parts.push(body.prompt)
  if (typeof body.input === 'string') parts.push(body.input)
  if (typeof body.task === 'string') parts.push(body.task)
  const messages = body.messages
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const content = (message as { content?: unknown }).content
      if (typeof content === 'string') {
        parts.push(content)
        continue
      }
      if (Array.isArray(content)) {
        for (const item of content) {
          if (!item || typeof item !== 'object') continue
          const text = (item as { text?: unknown }).text
          if (typeof text === 'string') parts.push(text)
        }
      }
    }
  }
  return parts.join('\n')
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function toChatRequest(body: Record<string, unknown>): ChatCompletionRequest {
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length > 0) {
    return body as unknown as ChatCompletionRequest
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : typeof body.input === 'string' ? body.input : ''
  return {
    ...(body as unknown as Record<string, unknown>),
    messages: prompt ? [{ role: 'user', content: prompt }] : []
  } as ChatCompletionRequest
}

async function pipeUpstreamStream(
  upstream: globalThis.Response,
  res: Response,
  onUsage?: (totalTokens: number) => void,
  onDeltaText?: (deltaText: string) => void
): Promise<void> {
  const contentType = upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8'
  res.status(upstream.status)
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  if (!upstream.body) {
    res.end()
    return
  }

  let sseBuffer = ''
  let streamedTotalTokens = 0
  const decoder = new TextDecoder()
  const parser = new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk)
      try {
        sseBuffer += decoder.decode(chunk as Buffer, { stream: true })
        const lines = sseBuffer.split(/\r?\n/)
        sseBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as {
              usage?: { total_tokens?: unknown }
              choices?: Array<{
                delta?: { content?: unknown }
                message?: { content?: unknown }
              }>
            }
            const total = Number(parsed.usage?.total_tokens)
            if (Number.isFinite(total) && total > streamedTotalTokens) {
              streamedTotalTokens = Math.floor(total)
              onUsage?.(streamedTotalTokens)
            }
            const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content
            const deltaText = normalizeContent(delta)
            if (deltaText) onDeltaText?.(deltaText)
          } catch {
            // ignore non-JSON data chunks
          }
        }
      } catch {
        // best effort only
      }
      callback()
    }
  })
  const stream = Readable.fromWeb(upstream.body as never)
  await pipeline(stream, parser, res)
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const intValue = Math.floor(parsed)
  if (intValue < 1) return undefined
  return intValue
}

function isSpeechFormat(value: unknown): value is AudioSpeechRequest['response_format'] {
  return value === 'mp3' || value === 'opus' || value === 'aac' || value === 'flac' || value === 'wav' || value === 'pcm'
}

function collectCompletionText(result: Record<string, unknown>): string {
  const choices = Array.isArray(result.choices) ? (result.choices as Array<Record<string, unknown>>) : []
  const parts = choices.map((choice) => {
    const message = choice.message as Record<string, unknown> | undefined
    const content = normalizeContent(message?.content)
    return content
  })
  return parts.filter(Boolean).join('\n')
}

function estimateTokenUsage(
  messages: ChatCompletionRequest['messages'],
  completionText: string
): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const promptTokens = estimatePromptTokens(messages)
  const completionTokens = estimateTokensFromText(completionText)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  }
}

function estimatePromptTokens(messages: ChatCompletionRequest['messages']): number {
  if (!Array.isArray(messages)) return 0
  let total = 0
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const msg = message as Record<string, unknown>
    const role = typeof msg.role === 'string' ? msg.role : 'user'
    const content = normalizeContent(msg.content)
    total += estimateTokensFromText(`${role}:${content}`)
    total += 2
  }
  return total
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0
  let cjk = 0
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (/\s/.test(char)) continue
    const code = char.codePointAt(0) ?? 0
    if (isCjk(code)) {
      cjk += 1
    } else if (code <= 0x7f) {
      ascii += 1
    } else {
      other += 1
    }
  }
  return cjk + Math.ceil(ascii / 4) + Math.ceil(other / 2)
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function normalizeContent(content: unknown): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in (item as Record<string, unknown>)) {
          const text = (item as Record<string, unknown>).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(Boolean)
    return parts.join('\n')
  }
  return ''
}

function normalizeSemanticChatResponse(result: ChatCompletionResponse, publicModelName: string): ChatCompletionResponse {
  return {
    ...result,
    model: publicModelName || result.model
  }
}

function normalizeEmbeddingsResponse(result: EmbeddingsResponse, publicModelName: string): EmbeddingsResponse {
  return {
    ...result,
    model: publicModelName || result.model
  }
}

export function setSemanticHeaders(res: Response, decision: SemanticDecision): void {
  res.set('x-semantic-category', decision.category)
  res.set('x-semantic-confidence', String(decision.confidence))
}

function persistLearnedMaxTokensIfNeeded(
  ctx: AppContext,
  type: ModelType,
  modelName: string
): void {
  if (type !== 'llm' && type !== 'multimodal') return
  const adapter = ctx.adapterRegistry.get(modelName) as { consumeLearnedMaxTokens?: () => number | undefined }
  if (typeof adapter.consumeLearnedMaxTokens !== 'function') return

  const learnedMaxTokens = adapter.consumeLearnedMaxTokens()
  if (!learnedMaxTokens || learnedMaxTokens < 1) return

  const model = ctx.config.models[type].find((item) => item.name === modelName)
  if (!model) return

  const changed = model.maxTokens !== learnedMaxTokens || model.maxTokensSource !== 'learned'
  if (!changed) return

  model.maxTokens = learnedMaxTokens
  model.maxTokensSource = 'learned'
  void saveConfigToFile(ctx.configPath, ctx.config).catch((error) => {
    logger.warn(
      `Failed to persist learned maxTokens for ${type}/${modelName}: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}

function persistQuotaDemotionIfNeeded(ctx: AppContext, type: ModelType, modelName: string): void {
  if (!isQuotaExhausted(ctx.modelPool, type, modelName)) return
  const changed = demoteModelToLowestPriority(ctx.config, type, modelName)
  if (!changed) return
  void saveConfigToFile(ctx.configPath, ctx.config).catch((error) => {
    logger.warn(
      `Failed to persist quota demotion for ${type}/${modelName}: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}

function estimateEmbeddingTokens(input: EmbeddingsRequest['input']): number {
  const toTokens = (text: string) => {
    if (!text) return 0
    return Math.max(1, Math.ceil(text.length / 4))
  }

  if (typeof input === 'string') {
    return toTokens(input)
  }

  if (!Array.isArray(input) || input.length === 0) {
    return 0
  }

  const first = input[0]
  if (typeof first === 'string') {
    return (input as string[]).reduce((sum, item) => sum + toTokens(item), 0)
  }

  if (typeof first === 'number') {
    return Math.max(1, Math.ceil((input as number[]).length / 4))
  }

  if (Array.isArray(first)) {
    return (input as number[][]).reduce((sum, item) => sum + Math.max(1, Math.ceil(item.length / 4)), 0)
  }

  return 0
}
