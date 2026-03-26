import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { createUnifiedTaskFromGatewayRequest, GatewayTaskRequest } from '../core/unified-task'
import { sendOpenAIError } from '../middlewares/error'
import { AppContext } from './context'
import { executeGatewayTask } from '../core/gateway-task-executor'
import { normalizeOpenClawRequest } from '../core/openclaw-adapter'

export function createTasksRouter(ctx: AppContext): Router {
  const router = Router()

  router.post('/resolve', (req, res) => {
    const body = (req.body ?? {}) as Partial<GatewayTaskRequest>
    if (!body.task || typeof body.task !== 'string' || !body.input || typeof body.input !== 'object') {
      sendOpenAIError(res, 400, 'Invalid gateway task request', 'invalid_request_error')
      return
    }

    const task = createUnifiedTaskFromGatewayRequest({
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
      task: body.task as GatewayTaskRequest['task'],
      input: body.input as Record<string, unknown>,
      hints: body.hints
    })

    res.json({
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : null,
      task
    })
  })

  router.post('/execute', async (req, res, next) => {
    const body = (req.body ?? {}) as Partial<GatewayTaskRequest>
    if (!body.task || typeof body.task !== 'string' || !body.input || typeof body.input !== 'object') {
      sendOpenAIError(res, 400, 'Invalid gateway task request', 'invalid_request_error')
      return
    }

    try {
      const result = await executeGatewayTask(ctx, {
        sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
        task: body.task as GatewayTaskRequest['task'],
        input: body.input as Record<string, unknown>,
        hints: body.hints
      }, {
        req,
        imageOptions: {
          publicBaseUrl: ctx.config.server.publicBaseUrl,
          signedUrlSecret: ctx.config.server.accessApiKey
        }
      })

      res.setHeader('X-AMR-Task-Type', result.task.taskType)
      res.setHeader('X-AMR-Route-Category', result.task.routeCategory)
      res.setHeader('X-AMR-Model-Name', result.modelName)
      res.type(result.contentType)

      if (result.responseType === 'stream') {
        const upstream = result.body as Response
        if (!upstream.body) {
          res.end()
          return
        }
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        const stream = Readable.fromWeb(upstream.body as never)
        await pipeline(stream, res)
        return
      }

      if (result.responseType === 'binary') {
        res.send(result.body)
        return
      }

      res.json(result.body)
    } catch (error) {
      next(error)
    }
  })

  router.post('/openclaw/resolve', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const gatewayTask = normalizeOpenClawRequest(body)
    const task = createUnifiedTaskFromGatewayRequest(gatewayTask)

    res.json({
      sessionKey: gatewayTask.sessionKey ?? null,
      gatewayTask,
      task
    })
  })

  router.post('/openclaw/execute', async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const gatewayTask = normalizeOpenClawRequest(body)

    try {
      const result = await executeGatewayTask(
        ctx,
        gatewayTask,
        {
          req,
          imageOptions: {
            publicBaseUrl: ctx.config.server.publicBaseUrl,
            signedUrlSecret: ctx.config.server.accessApiKey
          }
        }
      )

      res.setHeader('X-AMR-Task-Type', result.task.taskType)
      res.setHeader('X-AMR-Route-Category', result.task.routeCategory)
      res.setHeader('X-AMR-Model-Name', result.modelName)
      res.type(result.contentType)

      if (result.responseType === 'stream') {
        const upstream = result.body as Response
        if (!upstream.body) {
          res.end()
          return
        }
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        const stream = Readable.fromWeb(upstream.body as never)
        await pipeline(stream, res)
        return
      }

      if (result.responseType === 'binary') {
        res.send(result.body)
        return
      }

      res.json(result.body)
    } catch (error) {
      next(error)
    }
  })

  return router
}
