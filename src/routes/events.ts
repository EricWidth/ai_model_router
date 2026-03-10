import { Router } from 'express'
import { AppContext } from './context'

export function createEventsRouter(ctx: AppContext): Router {
  const router = Router()

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')

    const unsubscribe = ctx.runtimeEvents.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`)
    }, 15000)

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      res.end()
    })
  })

  return router
}
