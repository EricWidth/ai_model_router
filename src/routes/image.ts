import { Router } from 'express'
import { ImageGenerationRequest } from '../types'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { markModelSelected } from './model-selection'

export function createImageRouter(ctx: AppContext): Router {
  const router = Router()

  router.post('/generations', async (req, res, next) => {
    const started = Date.now()
    try {
      const body = req.body as ImageGenerationRequest
      if (!body.prompt) {
        sendOpenAIError(res, 400, 'Missing prompt', 'invalid_request_error', 'prompt')
        return
      }

      const { modelName, result } = await ctx.switchStrategy.execute('visual', async (modelName) => {
        const adapter = ctx.adapterRegistry.get(modelName)
        return adapter.image(body)
      })
      markModelSelected(ctx, 'visual', modelName)

      ctx.metrics.update('visual', modelName, true, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', { route: 'image', modelType: 'visual', modelName, success: true })
      res.json(result)
    } catch (error) {
      ctx.metrics.update('visual', 'unknown', false, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'image',
        modelType: 'visual',
        modelName: 'unknown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
      next(error)
    }
  })

  return router
}
