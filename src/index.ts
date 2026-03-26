import 'dotenv/config'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { ConfigManager } from './config'
import { AdapterRegistry } from './core/adapter-registry'
import { Metrics } from './core/metrics'
import { ModelPool } from './core/model-pool'
import { RuntimeEvents } from './core/runtime-events'
import { RuntimeStateStore } from './core/runtime-state-store'
import { SwitchStrategy } from './core/switch-strategy'
import { demoteAllQuotaExhaustedModels } from './core/quota-policy'
import { requestLogger } from './middlewares/logger'
import { errorHandler } from './middlewares/error'
import { generatedImageAuth } from './middlewares/generated-image-auth'
import { registerRoutes } from './routes'
import { logger } from './utils/logger'
import { saveConfigToFile } from './config/storage'
import { MODEL_TYPES } from './types'
import { GENERATED_IMAGES_ROUTE, resolveGeneratedImagesDir } from './routes/image-normalizer'
import { ModelAdapter } from './adapters/base'
import { handleOpenClawWebSocketUpgrade } from './core/openclaw-ws'

export async function startServer(): Promise<void> {
  const configPath = process.env.AMR_CONFIG ?? path.resolve(process.cwd(), 'examples/config.yaml')
  const configManager = new ConfigManager()
  const config = await configManager.load(configPath)
  const portOverrideRaw = process.env.AMR_PORT ?? process.env.PORT
  const portOverride = portOverrideRaw ? Number.parseInt(portOverrideRaw, 10) : undefined
  const hostOverride = process.env.AMR_HOST ?? process.env.HOST

  const modelPool = new ModelPool(config.models, config.switch)
  const runtimeStateStore = new RuntimeStateStore(configPath)
  const runtimeState = await runtimeStateStore.load()
  if (runtimeState.runtimeState) {
    modelPool.applyRuntimeStateSnapshot(runtimeState.runtimeState)
  } else if (runtimeState.tokenUsage) {
    modelPool.applyTokenUsageSnapshot(runtimeState.tokenUsage)
  }
  if (demoteAllQuotaExhaustedModels(config, modelPool)) {
    await saveConfigToFile(configPath, config)
  }
  modelPool.setChangeListener((snapshot) => {
    runtimeStateStore.scheduleSave(snapshot)
  })

  const metrics = new Metrics()
  const switchStrategy = new SwitchStrategy(modelPool, config.switch)
  const adapterRegistry = new AdapterRegistry(config)
  const runtimeEvents = new RuntimeEvents()
  const stopHealthChecks = startHealthCheckLoop(adapterRegistry, modelPool, config.switch.healthCheckInterval)

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  if (config.server.cors) app.use(cors())
  app.use(requestLogger)

  registerRoutes(app, { configPath, config, modelPool, metrics, switchStrategy, adapterRegistry, runtimeEvents })

  app.use(
    GENERATED_IMAGES_ROUTE,
    generatedImageAuth(() => config.server.accessApiKey),
    express.static(resolveGeneratedImagesDir())
  )

  const webRoot = resolveWebRoot()
  app.use('/', express.static(webRoot))

  app.use(errorHandler)

  const port = Number.isFinite(portOverride) ? portOverride! : config.server.port
  const host = hostOverride || config.server.host

  const server = http.createServer(app)
  server.on('upgrade', (req, socket, head) => {
    const handled = handleOpenClawWebSocketUpgrade(req, socket, head, {
      configPath,
      config,
      modelPool,
      metrics,
      switchStrategy,
      adapterRegistry,
      runtimeEvents
    }, config.server.accessApiKey)
    if (!handled) {
      socket.destroy()
    }
  })

  server.listen(port, host, () => {
    logger.info(`AI Model Router listening at http://${host}:${port}`)
    logger.info(`Web UI: http://localhost:${port}`)
  })

  const flushAndExit = async (code: number) => {
    stopHealthChecks()
    try {
      await runtimeStateStore.flushSave()
    } catch {
      // ignore flush errors during shutdown
    }
    process.exit(code)
  }

  process.on('SIGINT', () => {
    void flushAndExit(0)
  })
  process.on('SIGTERM', () => {
    void flushAndExit(0)
  })
}

function startHealthCheckLoop(
  adapterRegistry: AdapterRegistry,
  modelPool: ModelPool,
  healthCheckIntervalMs: number
): () => void {
  if (!Number.isFinite(healthCheckIntervalMs) || healthCheckIntervalMs <= 0) {
    return () => {}
  }

  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void runHealthCheckTick(adapterRegistry, modelPool).finally(() => {
      running = false
    })
  }, healthCheckIntervalMs)

  return () => {
    clearInterval(timer)
  }
}

async function runHealthCheckTick(adapterRegistry: AdapterRegistry, modelPool: ModelPool): Promise<void> {
  const states = modelPool.listStates()
  for (const type of MODEL_TYPES) {
    for (const state of states[type]) {
      if (!shouldProbeState(type, state.status)) continue
      try {
        const adapter = adapterRegistry.get(state.name)
        const healthy = await probeModelHealth(type, state.cooldownUntil, adapter)
        if (!healthy) continue
        modelPool.markHealthy(type, state.name)
      } catch (error) {
        logger.debug(
          `Health check failed for ${type}/${state.name}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
}

export function shouldProbeState(
  type: (typeof MODEL_TYPES)[number],
  status: 'available' | 'cooling' | 'unavailable' | 'quota_exhausted'
): boolean {
  if (status !== 'cooling' && status !== 'unavailable') return false
  return (
    type === 'llm' || type === 'multimodal' || type === 'vector' || type === 'voice' || type === 'visual'
  )
}

async function probeModelHealth(
  type: (typeof MODEL_TYPES)[number],
  cooldownUntil: number | undefined,
  adapter: ModelAdapter
): Promise<boolean> {
  if (type === 'llm' || type === 'multimodal') {
    await adapter.healthCheck()
    return true
  }

  if (type === 'vector') {
    await adapter.embeddings({ input: 'healthcheck' })
    return true
  }

  // For media generation models, avoid active probing that creates side effects/cost.
  // Recover them automatically once cooldown has elapsed; real traffic will verify availability.
  if (!cooldownUntil) return true
  return Date.now() >= cooldownUntil
}

function resolveWebRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/web/public'),
    path.resolve(__dirname, '../../src/web/public'),
    path.resolve(path.dirname(process.execPath), 'src/web/public'),
    path.resolve(path.dirname(process.execPath), 'web/public')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return path.resolve(process.cwd(), 'src/web/public')
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
