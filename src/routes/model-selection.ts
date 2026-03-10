import { saveConfigToFile } from '../config/storage'
import { logger } from '../utils/logger'
import { AppContext } from './context'
import { ModelType } from '../types'

export function markModelSelected(ctx: AppContext, type: ModelType, modelName: string): void {
  const models = ctx.config.models[type]
  if (!Array.isArray(models) || models.length === 0) return
  const target = models.find((model) => model.name === modelName)
  if (!target) return

  let changed = false
  for (const model of models) {
    const shouldSelected = model.name === target.name
    if (Boolean(model.selected) !== shouldSelected) {
      model.selected = shouldSelected
      changed = true
    }
  }

  const others = models
    .filter((model) => model.name !== target.name)
    .sort((a, b) => toPriority(a.priority) - toPriority(b.priority))
  const ordered = [target, ...others]
  for (let i = 0; i < ordered.length; i += 1) {
    const expected = i + 1
    if (toPriority(ordered[i].priority) !== expected) {
      ordered[i].priority = expected
      changed = true
    }
  }
  ctx.config.models[type] = ordered

  if (!changed) return
  void saveConfigToFile(ctx.configPath, ctx.config).catch((error) => {
    logger.warn(
      `Failed to persist selected model for ${type}/${modelName}: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}

function toPriority(priority: number | undefined): number {
  return Number.isFinite(priority) && Number(priority) > 0 ? Math.floor(Number(priority)) : 1
}
