import { Router } from 'express'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { EmbeddingsRequest, EmbeddingsResponse } from '../types'
import { isQuotaExhausted, demoteModelToLowestPriority } from '../core/quota-policy'
import { saveConfigToFile } from '../config/storage'
import { logger } from '../utils/logger'
import { markModelSelected } from './model-selection'

export function createVectorRouter(ctx: AppContext): Router {
  const router = Router()

  router.post('/embeddings', async (req, res, next) => {
    const started = Date.now()
    const body = req.body as EmbeddingsRequest

    try {
      if (!hasEmbeddingInput(body?.input)) {
        sendOpenAIError(res, 400, 'Invalid input', 'invalid_request_error', 'input')
        return
      }

      const { modelName, result } = await ctx.switchStrategy.execute('vector', async (modelName) => {
        const adapter = ctx.adapterRegistry.get(modelName)
        return adapter.embeddings(body)
      })
      markModelSelected(ctx, 'vector', modelName)

      const normalized = normalizeEmbeddingsResponse(result, ctx.config.server.publicModelName || 'custom-model')
      const tokens = normalized.usage?.total_tokens ?? estimateEmbeddingTokens(body.input)
      if (tokens > 0) {
        ctx.modelPool.addTokenUsage('vector', modelName, tokens)
        persistQuotaDemotionIfNeeded(ctx, modelName)
      }

      ctx.metrics.update('vector', modelName, true, Date.now() - started, tokens)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'vector',
        modelType: 'vector',
        modelName,
        success: true
      })
      res.json(normalized)
    } catch (error) {
      ctx.metrics.update('vector', 'unknown', false, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'vector',
        modelType: 'vector',
        modelName: 'unknown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
      next(error)
    }
  })

  return router
}

function persistQuotaDemotionIfNeeded(ctx: AppContext, modelName: string): void {
  if (!isQuotaExhausted(ctx.modelPool, 'vector', modelName)) return
  const changed = demoteModelToLowestPriority(ctx.config, 'vector', modelName)
  if (!changed) return
  void saveConfigToFile(ctx.configPath, ctx.config).catch((error) => {
    logger.warn(
      `Failed to persist quota demotion for vector/${modelName}: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}

function hasEmbeddingInput(input: unknown): boolean {
  if (typeof input === 'string') return input.trim().length > 0
  if (Array.isArray(input)) return input.length > 0
  return false
}

function normalizeEmbeddingsResponse(result: EmbeddingsResponse, publicModelName: string): EmbeddingsResponse {
  return {
    ...result,
    model: publicModelName || result.model
  }
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
