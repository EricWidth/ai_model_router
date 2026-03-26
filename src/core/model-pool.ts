import { ModelConfig, ModelType, MODEL_TYPES, SwitchConfig } from '../types'

export interface ModelState {
  name: string
  provider: string
  priority: number
  status: 'available' | 'cooling' | 'unavailable' | 'quota_exhausted'
  failureCount: number
  successCount: number
  totalRequests: number
  quota?: number
  usedTokens: number
  lastFailureTime?: number
  cooldownUntil?: number
}

export type TokenUsageSnapshot = Record<ModelType, Record<string, number>>

export interface PersistedModelRuntimeState {
  status: ModelState['status']
  failureCount: number
  successCount: number
  totalRequests: number
  usedTokens: number
  lastFailureTime?: number
  cooldownUntil?: number
}

export type RuntimeStateSnapshot = Record<ModelType, Record<string, PersistedModelRuntimeState>>

export class ModelPool {
  private readonly pools = new Map<ModelType, Map<string, ModelState>>()
  private onChange?: (snapshot: RuntimeStateSnapshot) => void

  constructor(models: Record<ModelType, ModelConfig[]>, private readonly switchConfig: SwitchConfig) {
    this.reload(models)
  }

  reload(models: Record<ModelType, ModelConfig[]>): void {
    const previous = new Map<ModelType, Map<string, ModelState>>()
    for (const type of MODEL_TYPES) {
      const oldPool = this.pools.get(type)
      if (oldPool) {
        previous.set(type, new Map(oldPool))
      }
    }

    this.pools.clear()
    MODEL_TYPES.forEach((type) => {
      const map = new Map<string, ModelState>()
      const prevPool = previous.get(type)
      for (const model of models[type]) {
        if (model.enabled === false) continue
        const prev = prevPool?.get(model.name)
        const usedTokens = prev?.usedTokens ?? 0
        map.set(model.name, {
          name: model.name,
          provider: model.provider,
          priority: model.priority,
          status: this.getInitialStatus(model.quota, usedTokens),
          failureCount: prev?.failureCount ?? 0,
          successCount: prev?.successCount ?? 0,
          totalRequests: prev?.totalRequests ?? 0,
          quota: model.quota,
          usedTokens,
          lastFailureTime: prev?.lastFailureTime,
          cooldownUntil: prev?.cooldownUntil
        })
        const state = map.get(model.name)
        if (state && prev) {
          this.applyPersistedRuntime(state, prev)
        }
      }
      this.pools.set(type, map)
    })
    this.emitChange()
  }

  getAvailableModels(type: ModelType): string[] {
    const now = Date.now()
    const pool = this.pools.get(type)
    if (!pool) return []

    const available = Array.from(pool.entries())
      .filter(([, state]) => {
        if (this.isQuotaExceeded(state)) {
          state.status = 'quota_exhausted'
          return false
        }
        if (state.status === 'unavailable' && state.cooldownUntil && now >= state.cooldownUntil) {
          state.status = 'available'
          state.cooldownUntil = undefined
        }
        if (state.status === 'cooling' && state.cooldownUntil && now >= state.cooldownUntil) {
          state.status = 'available'
          state.cooldownUntil = undefined
        }
        return state.status === 'available'
      })
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name]) => name)

    if (available.length > 0) {
      return available
    }

    // When every non-quota model is transiently blocked, release one model as a probe
    // to avoid hard outage caused by stale cooling/unavailable states.
    const fallback = Array.from(pool.entries())
      .filter(([, state]) => !this.isQuotaExceeded(state))
      .sort((a, b) => a[1].priority - b[1].priority)[0]

    if (!fallback) {
      return []
    }

    fallback[1].status = 'available'
    fallback[1].cooldownUntil = undefined
    return [fallback[0]]
  }

  recordSuccess(type: ModelType, modelName: string): void {
    const state = this.pools.get(type)?.get(modelName)
    if (!state) return
    state.successCount += 1
    state.totalRequests += 1
    if (!this.isQuotaExceeded(state)) {
      state.status = 'available'
    }
    state.cooldownUntil = undefined
    this.emitChange()
  }

  recordFailure(type: ModelType, modelName: string): void {
    const state = this.pools.get(type)?.get(modelName)
    if (!state) return
    state.failureCount += 1
    state.totalRequests += 1
    state.lastFailureTime = Date.now()
    state.status = 'cooling'
    state.cooldownUntil = Date.now() + this.switchConfig.cooldown
    this.emitChange()
  }

  markUnavailable(type: ModelType, modelName: string): void {
    const state = this.pools.get(type)?.get(modelName)
    if (state) {
      state.failureCount += 1
      state.totalRequests += 1
      state.lastFailureTime = Date.now()
      state.status = 'unavailable'
      state.cooldownUntil = Date.now() + this.switchConfig.cooldown
      this.emitChange()
    }
  }

  markHealthy(type: ModelType, modelName: string): void {
    const state = this.pools.get(type)?.get(modelName)
    if (!state) return
    if (this.isQuotaExceeded(state)) {
      state.status = 'quota_exhausted'
      return
    }
    state.status = 'available'
    state.cooldownUntil = undefined
    this.emitChange()
  }

  addTokenUsage(type: ModelType, modelName: string, tokenCount: number): void {
    const state = this.pools.get(type)?.get(modelName)
    if (!state || !Number.isFinite(tokenCount) || tokenCount <= 0) return
    state.usedTokens += Math.floor(tokenCount)
    if (this.isQuotaExceeded(state)) {
      state.status = 'quota_exhausted'
    }
    this.emitChange()
  }

  listStates(): Record<ModelType, ModelState[]> {
    return Object.fromEntries(MODEL_TYPES.map((type) => [type, Array.from(this.pools.get(type)?.values() ?? [])])) as Record<
      ModelType,
      ModelState[]
    >
  }

  getTokenUsageSnapshot(): TokenUsageSnapshot {
    return Object.fromEntries(MODEL_TYPES.map((type) => [type, toUsageMap(this.pools.get(type))])) as TokenUsageSnapshot
  }

  getRuntimeStateSnapshot(): RuntimeStateSnapshot {
    return Object.fromEntries(MODEL_TYPES.map((type) => [type, toRuntimeMap(this.pools.get(type))])) as RuntimeStateSnapshot
  }

  applyTokenUsageSnapshot(snapshot: Partial<TokenUsageSnapshot>): void {
    for (const type of MODEL_TYPES) {
      const usage = snapshot[type]
      if (!usage) continue
      const pool = this.pools.get(type)
      if (!pool) continue

      for (const [name, state] of pool.entries()) {
        const used = usage[name]
        if (Number.isFinite(used) && used >= 0) {
          state.usedTokens = Math.floor(used)
          state.status = this.getInitialStatus(state.quota, state.usedTokens)
        }
      }
    }
    this.emitChange()
  }

  applyRuntimeStateSnapshot(snapshot: Partial<RuntimeStateSnapshot>): void {
    for (const type of MODEL_TYPES) {
      const runtimeMap = snapshot[type]
      if (!runtimeMap) continue
      const pool = this.pools.get(type)
      if (!pool) continue

      for (const [name, state] of pool.entries()) {
        const runtime = runtimeMap[name]
        if (!runtime) continue
        this.applyPersistedRuntime(state, runtime)
      }
    }
    this.emitChange()
  }

  setChangeListener(listener?: (snapshot: RuntimeStateSnapshot) => void): void {
    this.onChange = listener
  }

  getStateSummary(type: ModelType): string {
    const states = this.pools.get(type)
    if (!states || states.size === 0) return 'empty'
    return Array.from(states.values())
      .map((s) => `${s.name}:${s.status}`)
      .join(', ')
  }

  private isQuotaExceeded(state: ModelState): boolean {
    return state.quota !== undefined && state.usedTokens >= state.quota
  }

  private getInitialStatus(quota: number | undefined, usedTokens: number): ModelState['status'] {
    if (quota !== undefined && usedTokens >= quota) {
      return 'quota_exhausted'
    }
    return 'available'
  }

  private applyPersistedRuntime(state: ModelState, runtime: PersistedModelRuntimeState): void {
    if (Number.isFinite(runtime.usedTokens) && runtime.usedTokens >= 0) {
      state.usedTokens = Math.floor(runtime.usedTokens)
    }
    if (Number.isFinite(runtime.failureCount) && runtime.failureCount >= 0) {
      state.failureCount = Math.floor(runtime.failureCount)
    }
    if (Number.isFinite(runtime.successCount) && runtime.successCount >= 0) {
      state.successCount = Math.floor(runtime.successCount)
    }
    if (Number.isFinite(runtime.totalRequests) && runtime.totalRequests >= 0) {
      state.totalRequests = Math.floor(runtime.totalRequests)
    }
    if (typeof runtime.lastFailureTime === 'number' && Number.isFinite(runtime.lastFailureTime)) {
      state.lastFailureTime = Math.floor(runtime.lastFailureTime)
    }
    if (typeof runtime.cooldownUntil === 'number' && Number.isFinite(runtime.cooldownUntil)) {
      state.cooldownUntil = Math.floor(runtime.cooldownUntil)
    }

    if (this.isQuotaExceeded(state)) {
      state.status = 'quota_exhausted'
      return
    }

    const now = Date.now()
    if ((runtime.status === 'cooling' || runtime.status === 'unavailable') && state.cooldownUntil && state.cooldownUntil > now) {
      state.status = runtime.status
      return
    }

    state.status = 'available'
    state.cooldownUntil = undefined
  }

  private emitChange(): void {
    if (!this.onChange) return
    this.onChange(this.getRuntimeStateSnapshot())
  }
}

function toUsageMap(pool?: Map<string, ModelState>): Record<string, number> {
  const map: Record<string, number> = {}
  for (const [name, state] of pool?.entries() ?? []) {
    map[name] = state.usedTokens
  }
  return map
}

function toRuntimeMap(pool?: Map<string, ModelState>): Record<string, PersistedModelRuntimeState> {
  const map: Record<string, PersistedModelRuntimeState> = {}
  for (const [name, state] of pool?.entries() ?? []) {
    map[name] = {
      status: state.status,
      failureCount: state.failureCount,
      successCount: state.successCount,
      totalRequests: state.totalRequests,
      usedTokens: state.usedTokens,
      lastFailureTime: state.lastFailureTime,
      cooldownUntil: state.cooldownUntil
    }
  }
  return map
}
