import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { ModelConfig, ModelType, MODEL_TYPES, SwitchConfig } from '../types'
import { AppContext } from './context'
import { saveConfigToFile } from '../config/storage'
import { sendOpenAIError } from '../middlewares/error'

export function createAdminRouter(ctx: AppContext): Router {
  const router = Router()

  router.get('/models', (_req, res) => {
    const masked = Object.fromEntries(
      MODEL_TYPES.map((type) => [
        type,
        ctx.config.models[type].map((model) => ({
          ...model,
          apiKey: maskApiKey(model.apiKey)
        }))
      ])
    ) as Record<ModelType, ModelConfig[]>
    const activeModels = Object.fromEntries(
      MODEL_TYPES.map((type) => [type, getPreferredModelName(ctx.config.models[type])])
    ) as Record<ModelType, string | null>
    res.json({ models: masked, states: ctx.modelPool.listStates(), activeModels })
  })

  router.get('/settings/gateway', (_req, res) => {
    res.json({
      port: ctx.config.server.port,
      host: ctx.config.server.host,
      cors: Boolean(ctx.config.server.cors),
      publicModelName: (ctx.config.server.publicModelName || 'custom-model').trim(),
      accessApiKey: maskApiKey(ctx.config.server.accessApiKey || ''),
      hasAccessApiKey: Boolean(ctx.config.server.accessApiKey),
      adminApiKey: maskApiKey(ctx.config.server.adminApiKey || ''),
      hasAdminApiKey: Boolean(ctx.config.server.adminApiKey),
      switch: {
        maxRetries: ctx.config.switch.maxRetries,
        cooldown: ctx.config.switch.cooldown,
        healthCheckInterval: ctx.config.switch.healthCheckInterval
      }
    })
  })

  router.put('/settings/access-key', async (req, res) => {
    const accessApiKey = String(req.body?.accessApiKey ?? '').trim()
    if (!accessApiKey) {
      sendOpenAIError(res, 400, 'accessApiKey is required', 'invalid_request_error', 'accessApiKey')
      return
    }

    const oldValue = ctx.config.server.accessApiKey
    try {
      ctx.config.server.accessApiKey = accessApiKey
      await saveConfigToFile(ctx.configPath, ctx.config)
      res.json({
        accessApiKey: maskApiKey(accessApiKey),
        hasAccessApiKey: true
      })
    } catch (error) {
      ctx.config.server.accessApiKey = oldValue
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Failed to update accessApiKey',
        'invalid_request_error'
      )
    }
  })

  router.put('/settings/gateway', async (req, res) => {
    const oldServer = { ...ctx.config.server }
    const oldSwitch: SwitchConfig = { ...ctx.config.switch }
    let updated = false
    let restartRequired = false

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'accessApiKey')) {
      const accessApiKey = String(req.body?.accessApiKey ?? '').trim()
      if (!accessApiKey) {
        sendOpenAIError(res, 400, 'accessApiKey is required', 'invalid_request_error', 'accessApiKey')
        return
      }
      ctx.config.server.accessApiKey = accessApiKey
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'port')) {
      const parsedPort = Number.parseInt(String(req.body?.port), 10)
      if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        sendOpenAIError(res, 400, 'Invalid port', 'invalid_request_error', 'port')
        return
      }
      if (parsedPort !== ctx.config.server.port) {
        restartRequired = true
      }
      ctx.config.server.port = parsedPort
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'host')) {
      const host = String(req.body?.host ?? '').trim()
      if (!host) {
        sendOpenAIError(res, 400, 'host is required', 'invalid_request_error', 'host')
        return
      }
      if (host !== ctx.config.server.host) {
        restartRequired = true
      }
      ctx.config.server.host = host
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'cors')) {
      const raw = req.body?.cors
      const cors =
        typeof raw === 'boolean'
          ? raw
          : String(raw).trim().toLowerCase() === 'true'
      ctx.config.server.cors = cors
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'publicModelName')) {
      const publicModelName = String(req.body?.publicModelName ?? '').trim()
      if (!publicModelName) {
        sendOpenAIError(res, 400, 'publicModelName is required', 'invalid_request_error', 'publicModelName')
        return
      }
      ctx.config.server.publicModelName = publicModelName
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'adminApiKey')) {
      const adminApiKey = String(req.body?.adminApiKey ?? '').trim()
      if (!adminApiKey) {
        sendOpenAIError(res, 400, 'adminApiKey is required', 'invalid_request_error', 'adminApiKey')
        return
      }
      ctx.config.server.adminApiKey = adminApiKey
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'maxRetries')) {
      const maxRetries = Number.parseInt(String(req.body?.maxRetries), 10)
      if (!Number.isFinite(maxRetries) || maxRetries < 1) {
        sendOpenAIError(res, 400, 'maxRetries must be an integer >= 1', 'invalid_request_error', 'maxRetries')
        return
      }
      ctx.config.switch.maxRetries = maxRetries
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'cooldown')) {
      const cooldown = Number.parseInt(String(req.body?.cooldown), 10)
      if (!Number.isFinite(cooldown) || cooldown < 0) {
        sendOpenAIError(res, 400, 'cooldown must be an integer >= 0', 'invalid_request_error', 'cooldown')
        return
      }
      ctx.config.switch.cooldown = cooldown
      updated = true
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'healthCheckInterval')) {
      const healthCheckInterval = Number.parseInt(String(req.body?.healthCheckInterval), 10)
      if (!Number.isFinite(healthCheckInterval) || healthCheckInterval < 0) {
        sendOpenAIError(
          res,
          400,
          'healthCheckInterval must be an integer >= 0',
          'invalid_request_error',
          'healthCheckInterval'
        )
        return
      }
      ctx.config.switch.healthCheckInterval = healthCheckInterval
      updated = true
    }

    if (!updated) {
      sendOpenAIError(res, 400, 'No valid gateway settings provided', 'invalid_request_error')
      return
    }

    try {
      await saveConfigToFile(ctx.configPath, ctx.config)
      res.json({
        port: ctx.config.server.port,
        host: ctx.config.server.host,
        cors: Boolean(ctx.config.server.cors),
        publicModelName: (ctx.config.server.publicModelName || 'custom-model').trim(),
        accessApiKey: maskApiKey(ctx.config.server.accessApiKey || ''),
        hasAccessApiKey: Boolean(ctx.config.server.accessApiKey),
        adminApiKey: maskApiKey(ctx.config.server.adminApiKey || ''),
        hasAdminApiKey: Boolean(ctx.config.server.adminApiKey),
        switch: {
          maxRetries: ctx.config.switch.maxRetries,
          cooldown: ctx.config.switch.cooldown,
          healthCheckInterval: ctx.config.switch.healthCheckInterval
        },
        restartRequired
      })
    } catch (error) {
      ctx.config.server = oldServer
      ctx.config.switch = oldSwitch
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Failed to update gateway settings',
        'invalid_request_error'
      )
    }
  })

  router.post('/models', async (req, res) => {
    const type = req.body.type as ModelType
    let modelInput: Partial<ModelConfig>
    try {
      modelInput = normalizeModelInput(parseModelInput(req.body.model))
    } catch (error) {
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Invalid model payload',
        'invalid_request_error'
      )
      return
    }

    if (!MODEL_TYPES.includes(type) || !modelInput?.name || !modelInput?.provider || !modelInput?.apiKey) {
      sendOpenAIError(res, 400, 'Invalid model payload', 'invalid_request_error')
      return
    }

    const newModel = { ...(modelInput as ModelConfig), id: modelInput.id ?? randomUUID() }

    const snapshot = cloneModels(ctx)
    try {
      ctx.config.models[type].push(newModel)
      ctx.adapterRegistry.upsert(type, newModel)
      ctx.modelPool.reload(ctx.config.models)
      await saveConfigToFile(ctx.configPath, ctx.config)
      res.status(201).json({ model: { ...newModel, apiKey: maskApiKey(newModel.apiKey) } })
    } catch (error) {
      restoreModels(ctx, snapshot)
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Failed to add model',
        'invalid_request_error'
      )
    }
  })

  router.post('/models/batch', async (req, res) => {
    const type = req.body.type as ModelType
    let modelTemplate: Partial<ModelConfig>
    try {
      modelTemplate = normalizeModelInput(parseModelInput(req.body.model))
    } catch (error) {
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Invalid model payload',
        'invalid_request_error'
      )
      return
    }

    if (!MODEL_TYPES.includes(type) || !modelTemplate?.provider || !modelTemplate?.apiKey) {
      sendOpenAIError(res, 400, 'Invalid model payload', 'invalid_request_error')
      return
    }

    const parsedNames = parseModelNames(req.body?.names)
    if (parsedNames.length === 0) {
      sendOpenAIError(res, 400, 'names is required', 'invalid_request_error', 'names')
      return
    }

    const existingNames = new Set(ctx.config.models[type].map((model) => model.name))
    const duplicateNames = parsedNames.filter((name) => existingNames.has(name))
    const creatableNames = parsedNames.filter((name) => !existingNames.has(name))
    const newModels: ModelConfig[] = creatableNames.map((name) => ({
      ...(modelTemplate as ModelConfig),
      id: randomUUID(),
      name
    }))

    if (newModels.length === 0) {
      res.status(200).json({
        createdCount: 0,
        skippedCount: duplicateNames.length,
        failedNames: duplicateNames,
        models: []
      })
      return
    }

    const snapshot = cloneModels(ctx)
    try {
      ctx.config.models[type].push(...newModels)
      for (const model of newModels) {
        ctx.adapterRegistry.upsert(type, model)
      }
      ctx.modelPool.reload(ctx.config.models)
      await saveConfigToFile(ctx.configPath, ctx.config)
      res.status(201).json({
        createdCount: newModels.length,
        skippedCount: duplicateNames.length,
        failedNames: duplicateNames,
        models: newModels.map((model) => ({ ...model, apiKey: maskApiKey(model.apiKey) }))
      })
    } catch (error) {
      restoreModels(ctx, snapshot)
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Failed to add models',
        'invalid_request_error'
      )
    }
  })

  router.put('/models/:name', async (req, res) => {
    const { name } = req.params
    let payload: Partial<ModelConfig>
    try {
      payload = normalizeModelInput(parseModelInput(req.body))
    } catch (error) {
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Invalid model payload',
        'invalid_request_error'
      )
      return
    }
    const snapshot = cloneModels(ctx)

    for (const type of MODEL_TYPES) {
      const idx = ctx.config.models[type].findIndex((m) => m.name === name)
      if (idx >= 0) {
        const updated = { ...ctx.config.models[type][idx], ...payload }

        try {
          ctx.config.models[type][idx] = updated
          ctx.adapterRegistry.upsert(type, updated)
          ctx.modelPool.reload(ctx.config.models)
          await saveConfigToFile(ctx.configPath, ctx.config)
          res.json({ model: { ...updated, apiKey: maskApiKey(updated.apiKey) } })
        } catch (error) {
          restoreModels(ctx, snapshot)
          sendOpenAIError(
            res,
            400,
            error instanceof Error ? error.message : 'Failed to update model',
            'invalid_request_error'
          )
        }
        return
      }
    }

    sendOpenAIError(res, 404, 'Model not found', 'not_found_error')
  })

  router.patch('/models/:name/quota', async (req, res) => {
    const { name } = req.params
    const rawQuota = req.body?.quota
    const parsedQuota =
      rawQuota === null || rawQuota === '' || rawQuota === undefined ? undefined : Number.parseInt(String(rawQuota), 10)
    if (parsedQuota !== undefined && (!Number.isFinite(parsedQuota) || parsedQuota < 0)) {
      sendOpenAIError(res, 400, 'quota must be an integer >= 0', 'invalid_request_error', 'quota')
      return
    }

    const snapshot = cloneModels(ctx)
    for (const type of MODEL_TYPES) {
      const idx = ctx.config.models[type].findIndex((m) => m.name === name)
      if (idx < 0) continue

      try {
        const model = ctx.config.models[type][idx]
        model.quota = parsedQuota
        ctx.modelPool.reload(ctx.config.models)
        await saveConfigToFile(ctx.configPath, ctx.config)
        res.json({
          model: {
            ...model,
            apiKey: maskApiKey(model.apiKey)
          }
        })
      } catch (error) {
        restoreModels(ctx, snapshot)
        sendOpenAIError(
          res,
          400,
          error instanceof Error ? error.message : 'Failed to update model quota',
          'invalid_request_error'
        )
      }
      return
    }

    sendOpenAIError(res, 404, 'Model not found', 'not_found_error')
  })

  router.post('/models/:type/:name/activate', async (req, res) => {
    const type = req.params.type as ModelType
    const name = req.params.name
    if (!MODEL_TYPES.includes(type)) {
      sendOpenAIError(res, 400, 'Invalid model type', 'invalid_request_error', 'type')
      return
    }

    const snapshot = cloneModels(ctx)
    try {
      const models = ctx.config.models[type]
      const target = models.find((m) => m.name === name)
      if (!target) {
        sendOpenAIError(res, 404, 'Model not found', 'not_found_error')
        return
      }

      const others = models
        .filter((m) => m.name !== name)
        .sort((a, b) => (a.priority || 9999) - (b.priority || 9999))

      target.priority = 1
      target.selected = true
      others.forEach((m, idx) => {
        m.priority = idx + 2
        m.selected = false
      })

      ctx.config.models[type] = [target, ...others]
      ctx.adapterRegistry.reload(ctx.config)
      ctx.modelPool.reload(ctx.config.models)
      await saveConfigToFile(ctx.configPath, ctx.config)

      res.json({
        type,
        activatedModel: name,
        priorities: ctx.config.models[type].map((m) => ({ name: m.name, priority: m.priority }))
      })
    } catch (error) {
      restoreModels(ctx, snapshot)
      sendOpenAIError(
        res,
        400,
        error instanceof Error ? error.message : 'Failed to activate model',
        'invalid_request_error'
      )
    }
  })

  router.delete('/models/:name', async (req, res) => {
    const { name } = req.params
    const snapshot = cloneModels(ctx)

    for (const type of MODEL_TYPES) {
      const before = ctx.config.models[type].length
      ctx.config.models[type] = ctx.config.models[type].filter((m) => m.name !== name)
      if (ctx.config.models[type].length !== before) {
        try {
          ctx.adapterRegistry.remove(type, name)
          ctx.modelPool.reload(ctx.config.models)
          await saveConfigToFile(ctx.configPath, ctx.config)
          res.status(204).send()
        } catch (error) {
          restoreModels(ctx, snapshot)
          sendOpenAIError(
            res,
            400,
            error instanceof Error ? error.message : 'Failed to delete model',
            'invalid_request_error'
          )
        }
        return
      }
    }

    sendOpenAIError(res, 404, 'Model not found', 'not_found_error')
  })

  router.get('/stats', (_req, res) => {
    const limitParam = Number.parseInt(String(_req.query.limit ?? '100'), 10)
    const limit = Number.isFinite(limitParam) ? limitParam : 100
    res.json({ metrics: ctx.metrics.getAll(), recentCalls: ctx.metrics.getCallRecords(limit) })
  })

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() })
  })

  router.get('/events', (req, res) => {
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

function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

function normalizeModelInput<T extends Partial<ModelConfig>>(input: T): T {
  if (!input || typeof input !== 'object') return input

  const normalized = { ...input }
  const hasMaxTokens = Object.prototype.hasOwnProperty.call(normalized, 'maxTokens')
  const hasMaxTokensSource = Object.prototype.hasOwnProperty.call(normalized, 'maxTokensSource')
  if (typeof normalized.name === 'string') normalized.name = normalized.name.trim()
  if (typeof normalized.provider === 'string') normalized.provider = normalized.provider.trim().toLowerCase()
  if (typeof normalized.apiKey === 'string') normalized.apiKey = normalized.apiKey.trim()
  if (typeof normalized.baseUrl === 'string') normalized.baseUrl = normalized.baseUrl.trim()
  if (normalized.baseUrl === '') delete normalized.baseUrl
  if (typeof normalized.quota === 'string') {
    const parsed = Number.parseInt(normalized.quota, 10)
    normalized.quota = Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof normalized.maxTokens === 'string') {
    const parsed = Number.parseInt(normalized.maxTokens, 10)
    normalized.maxTokens = Number.isFinite(parsed) ? parsed : undefined
  }
  if (normalized.maxTokens === null) {
    normalized.maxTokens = undefined
  }
  if (typeof normalized.maxTokensSource === 'string') {
    const lowered = normalized.maxTokensSource.trim().toLowerCase()
    normalized.maxTokensSource = lowered === 'manual' || lowered === 'learned' ? lowered : undefined
  } else if (normalized.maxTokensSource === null) {
    normalized.maxTokensSource = undefined
  }

  if (hasMaxTokens && normalized.maxTokens !== undefined && !normalized.maxTokensSource) {
    normalized.maxTokensSource = 'manual'
  }
  if (hasMaxTokens && normalized.maxTokens === undefined && !hasMaxTokensSource) {
    normalized.maxTokensSource = undefined
  }

  return normalized
}

function parseModelInput(input: unknown): Partial<ModelConfig> {
  if (typeof input === 'string') {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Model JSON string must be an object')
    }
    return parsed as Partial<ModelConfig>
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Model payload must be an object or JSON string')
  }

  const obj = input as Record<string, unknown>
  const jsonConfig = obj.jsonConfig
  if (typeof jsonConfig === 'string' && jsonConfig.trim()) {
    const extra = JSON.parse(jsonConfig) as unknown
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      throw new Error('jsonConfig must be a JSON object string')
    }
    const merged = { ...obj, ...(extra as Record<string, unknown>) }
    delete (merged as { jsonConfig?: unknown }).jsonConfig
    return merged as Partial<ModelConfig>
  }

  return obj as Partial<ModelConfig>
}

function cloneModels(ctx: AppContext): Record<ModelType, ModelConfig[]> {
  return JSON.parse(JSON.stringify(ctx.config.models)) as Record<ModelType, ModelConfig[]>
}

function restoreModels(ctx: AppContext, snapshot: Record<ModelType, ModelConfig[]>): void {
  ctx.config.models = snapshot
  ctx.adapterRegistry.reload(ctx.config)
  ctx.modelPool.reload(ctx.config.models)
}

function getPreferredModelName(models: ModelConfig[]): string | null {
  const candidates = models.filter((m) => m.enabled !== false)
  if (candidates.length === 0) return null
  const selected = candidates.find((m) => m.selected === true)
  if (selected?.name) return selected.name
  const first = candidates.sort((a, b) => a.priority - b.priority)[0]
  return first?.name ?? null
}

function parseModelNames(input: unknown): string[] {
  if (Array.isArray(input)) {
    const names = input
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    return Array.from(new Set(names))
  }

  if (typeof input === 'string') {
    const names = input
      .split(/[,\n，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return Array.from(new Set(names))
  }

  return []
}
