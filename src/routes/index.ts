import { Application } from 'express'
import { createChatRouter } from './chat'
import { createAudioRouter } from './audio'
import { createImageRouter } from './image'
import { createModelsRouter } from './models'
import { createAdminRouter } from './admin'
import { createEventsRouter } from './events'
import { accessAuth, adminAuth } from '../middlewares/auth'
import { AppContext } from './context'

export function registerRoutes(app: Application, ctx: AppContext): void {
  app.use('/v1', accessAuth(() => ctx.config.server.accessApiKey), createModelsRouter(ctx))
  app.use('/v1/chat', accessAuth(() => ctx.config.server.accessApiKey), createChatRouter(ctx))
  app.use('/v1/audio', accessAuth(() => ctx.config.server.accessApiKey), createAudioRouter(ctx))
  app.use('/v1/images', accessAuth(() => ctx.config.server.accessApiKey), createImageRouter(ctx))
  app.use('/events', accessAuth(() => ctx.config.server.accessApiKey), createEventsRouter(ctx))

  app.use('/_internal', adminAuth(() => ctx.config.server.adminApiKey), createAdminRouter(ctx))
}
