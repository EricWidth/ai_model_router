import { Router } from 'express'
import { AudioSpeechRequest } from '../types'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { markModelSelected } from './model-selection'

export function createAudioRouter(ctx: AppContext): Router {
  const router = Router()

  router.post('/speech', async (req, res, next) => {
    const started = Date.now()
    try {
      const body = req.body as AudioSpeechRequest
      if (!body.input || !body.voice) {
        sendOpenAIError(res, 400, 'Invalid speech request', 'invalid_request_error')
        return
      }

      const { modelName, result: buffer } = await ctx.switchStrategy.execute('voice', async (modelName) => {
        const adapter = ctx.adapterRegistry.get(modelName)
        return adapter.speech(body)
      })
      markModelSelected(ctx, 'voice', modelName)

      ctx.metrics.update('voice', modelName, true, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', { route: 'speech', modelType: 'voice', modelName, success: true })
      res.set('Content-Type', 'audio/mpeg')
      res.send(buffer)
    } catch (error) {
      ctx.metrics.update('voice', 'unknown', false, Date.now() - started, 0)
      ctx.runtimeEvents.emit('request.completed', {
        route: 'speech',
        modelType: 'voice',
        modelName: 'unknown',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
      next(error)
    }
  })

  return router
}
