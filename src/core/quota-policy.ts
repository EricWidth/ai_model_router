import { AppConfig, ModelType, MODEL_TYPES } from '../types'
import { ModelPool } from './model-pool'

export function isQuotaExhausted(modelPool: ModelPool, type: ModelType, modelName: string): boolean {
  const state = modelPool
    .listStates()
    [type].find((item) => item.name === modelName)
  return state?.status === 'quota_exhausted'
}

export function demoteModelToLowestPriority(config: AppConfig, type: ModelType, modelName: string): boolean {
  const models = config.models[type]
  const target = models.find((model) => model.name === modelName)
  if (!target) return false

  const maxPriorityOfOthers = models
    .filter((model) => model.name !== modelName)
    .reduce((max, model) => Math.max(max, toPriority(model.priority)), 0)
  const lowestPriority = Math.max(maxPriorityOfOthers + 1, toPriority(target.priority))

  let changed = false
  if (toPriority(target.priority) !== lowestPriority) {
    target.priority = lowestPriority
    changed = true
  }
  if (target.selected !== false) {
    target.selected = false
    changed = true
  }

  return changed
}

export function demoteAllQuotaExhaustedModels(config: AppConfig, modelPool: ModelPool): boolean {
  let changed = false
  const states = modelPool.listStates()

  for (const type of MODEL_TYPES) {
    for (const state of states[type]) {
      if (state.status !== 'quota_exhausted') continue
      if (demoteModelToLowestPriority(config, type, state.name)) {
        changed = true
      }
    }
  }

  return changed
}

function toPriority(priority: number | undefined): number {
  return Number.isFinite(priority) && Number(priority) > 0 ? Math.floor(Number(priority)) : 1
}
