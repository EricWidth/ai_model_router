import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { Response, Router } from 'express'
import { randomUUID } from 'node:crypto'
import { ChatCompletionRequest, ChatCompletionResponse, ModelType } from '../types'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { isQuotaExhausted, demoteModelToLowestPriority } from '../core/quota-policy'
import { saveConfigToFile } from '../config/storage'
import { logger } from '../utils/logger'
import { markModelSelected } from './model-selection'

export function createChatRouter(ctx: AppContext): Router {
  return createTypedChatRouter(ctx, 'llm', 'chat')
}

export function createMultimodalRouter(ctx: AppContext): Router {
  return createTypedChatRouter(ctx, 'multimodal', 'multimodal')
}

function createTypedChatRouter(ctx: AppContext, modelType: 'llm' | 'multimodal', route: string): Router {
  const router = Router()

  router.post('/completions', async (req, res, next) => {
    const started = Date.now()
    const body = req.body as ChatCompletionRequest
    try {
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        sendOpenAIError(res, 400, 'Invalid messages', 'invalid_request_error')
        return
      }

      const wantsStream = body.stream !== false
      if (wantsStream) {
        const { modelName, result: upstream } = await ctx.switchStrategy.execute(modelType, async (modelName) => {
          const adapter = ctx.adapterRegistry.get(modelName)
          return adapter.chatStream(body)
        })
        persistLearnedMaxTokensIfNeeded(ctx, modelType, modelName)
        markModelSelected(ctx, modelType, modelName)
        let streamTotalTokens = 0
        let streamedText = ''
        let completedEventSent = false
        const emitCompleted = (success: boolean, errorMessage?: string) => {
          if (completedEventSent) return
          completedEventSent = true
          if (success && streamTotalTokens <= 0) {
            const estimated = estimateTokenUsage(body.messages, streamedText)
            streamTotalTokens = estimated.total_tokens
          }
          if (success && streamTotalTokens > 0) {
            ctx.modelPool.addTokenUsage(modelType, modelName, streamTotalTokens)
            persistQuotaDemotionIfNeeded(ctx, modelType, modelName)
          }
          ctx.metrics.update(modelType, modelName, success, Date.now() - started, streamTotalTokens)
          ctx.runtimeEvents.emit('request.completed', {
            route,
            modelType,
            modelName,
            success,
            stream: true,
            tokens: streamTotalTokens,
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

      const { modelName, result } = await ctx.switchStrategy.execute(modelType, async (modelName) => {
        const adapter = ctx.adapterRegistry.get(modelName)
        return adapter.chat(body)
      })
      persistLearnedMaxTokensIfNeeded(ctx, modelType, modelName)
      markModelSelected(ctx, modelType, modelName)

      const sanitized = normalizeChatResponse(result, ctx.config.server.publicModelName || 'custom-model')
      let tokens = sanitized.usage?.total_tokens ?? 0
      if (tokens <= 0) {
        const completionText = collectCompletionText(sanitized)
        const estimated = estimateTokenUsage(body.messages, completionText)
        tokens = estimated.total_tokens
        sanitized.usage = estimated
      }
      ctx.modelPool.addTokenUsage(modelType, modelName, tokens)
      persistQuotaDemotionIfNeeded(ctx, modelType, modelName)
      ctx.metrics.update(modelType, modelName, true, Date.now() - started, tokens)
      ctx.runtimeEvents.emit('request.completed', { route, modelType, modelName, success: true, stream: false })
      res.json(sanitized)
    } catch (error) {
      if (body.stream !== true) {
        ctx.metrics.update(modelType, 'unknown', false, Date.now() - started, 0)
        ctx.runtimeEvents.emit('request.completed', {
          route,
          modelType,
          modelName: 'unknown',
          success: false,
          stream: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      next(error)
    }
  })

  return router
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

function persistLearnedMaxTokensIfNeeded(ctx: AppContext, type: 'llm' | 'multimodal', modelName: string): void {
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
        // parsing is best-effort and must not break streaming
      }
      callback()
    }
  })

  const stream = Readable.fromWeb(upstream.body as any)
  await pipeline(stream, parser, res)
}

function normalizeChatResponse(result: ChatCompletionResponse, publicModelName: string): ChatCompletionResponse {
  const source = result as unknown as {
    id?: string
    object?: string
    created?: number
    choices?: Array<{
      index?: number
      finish_reason?: string
      message?: {
        role?: string
        content?: unknown
        tool_calls?: unknown
        function_call?: unknown
        reasoning_content?: unknown
      }
    }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
  }

  const normalizedChoices =
    source.choices && source.choices.length > 0
      ? source.choices.map((choice, idx) => {
          const normalizedContent = normalizeContent(choice.message?.content)
          const toolCalls = isToolCalls(choice.message?.tool_calls) ? choice.message?.tool_calls : undefined
          const functionCall = isFunctionCall(choice.message?.function_call) ? choice.message?.function_call : undefined
          return {
            index: Number.isFinite(choice.index) ? Number(choice.index) : idx,
            message: {
              role: choice.message?.role || 'assistant',
              content: normalizedContent || !toolCalls && !functionCall ? normalizedContent : null,
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
              ...(functionCall ? { function_call: functionCall } : {})
            },
            finish_reason: choice.finish_reason || 'stop'
          }
        })
      : [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: ''
            },
            finish_reason: 'stop'
          }
        ]

  const usage = normalizeUsage(source.usage)
  return {
    id: source.id || `chatcmpl-${randomUUID()}`,
    object: source.object || 'chat.completion',
    created: Number.isFinite(source.created) ? Number(source.created) : Math.floor(Date.now() / 1000),
    model: publicModelName,
    choices: normalizedChoices,
    usage
  }
}

function normalizeContent(content: unknown): string {
  if (content === null) return ''
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

function isToolCalls(value: unknown): value is Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> {
  return Array.isArray(value)
}

function isFunctionCall(value: unknown): value is { name?: string; arguments?: string } {
  return Boolean(value) && typeof value === 'object'
}

function normalizeUsage(usage: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  if (!usage || typeof usage !== 'object') {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  }

  const raw = usage as Record<string, unknown>
  const prompt = toNonNegativeInt(raw.prompt_tokens)
  const completion = toNonNegativeInt(raw.completion_tokens)
  const total = toNonNegativeInt(raw.total_tokens)
  if (total > 0) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total }
  }
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion
  }
}

function toNonNegativeInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function collectCompletionText(result: ChatCompletionResponse): string {
  const choices = Array.isArray(result.choices) ? result.choices : []
  const parts = choices.map((choice) => {
    const message = choice.message
    const content = normalizeContent(message?.content)
    const toolCalls = isToolCalls(message?.tool_calls) ? JSON.stringify(message?.tool_calls) : ''
    const functionCall = isFunctionCall(message?.function_call) ? JSON.stringify(message?.function_call) : ''
    return `${content}${toolCalls}${functionCall}`
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
    const toolCalls = isToolCalls(msg.tool_calls) ? JSON.stringify(msg.tool_calls) : ''
    const functionCall = isFunctionCall(msg.function_call) ? JSON.stringify(msg.function_call) : ''
    total += estimateTokensFromText(`${role}:${content}${toolCalls}${functionCall}`)
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
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana/Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  )
}
