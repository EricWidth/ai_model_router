import { Router } from 'express'
import { AppContext } from './context'
import { sendOpenAIError } from '../middlewares/error'
import { MODEL_TYPES } from '../types'

interface OpenAIModelItem {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export function createModelsRouter(ctx: AppContext): Router {
  const router = Router()

  router.get('/models', (_req, res) => {
    const created = Math.floor(Date.now() / 1000)
    const items = listOpenAIModels(ctx, created)

    res.json({
      object: 'list',
      data: items
    })
  })

  router.get('/models/:id', (req, res) => {
    const id = String(req.params.id || '').trim()
    const created = Math.floor(Date.now() / 1000)
    const found = listOpenAIModels(ctx, created).find((item) => item.id === id)

    if (!found) {
      sendOpenAIError(
        res,
        404,
        `The model \`${id}\` does not exist or you do not have access to it.`,
        'not_found_error',
        null,
        'model_not_found'
      )
      return
    }

    res.json(found)
  })

  return router
}

function toModel(name: string, created: number): OpenAIModelItem {
  return {
    id: name,
    object: 'model',
    created,
    owned_by: 'ai-model-router'
  }
}

function listOpenAIModels(ctx: AppContext, created: number): OpenAIModelItem[] {
  const publicModel = (ctx.config.server.publicModelName || 'custom-model').trim()
  const names = new Set<string>()
  const items: OpenAIModelItem[] = []

  if (publicModel) {
    names.add(publicModel)
    items.push(toModel(publicModel, created))
  }

  for (const type of MODEL_TYPES) {
    for (const model of ctx.config.models[type]) {
      if (model.enabled === false) continue
      if (names.has(model.name)) continue
      names.add(model.name)
      items.push(toModel(model.name, created))
    }
  }

  return items
}
