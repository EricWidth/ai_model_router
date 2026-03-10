import { ModelType } from '../types'

interface MetricState {
  total: number
  success: number
  failure: number
  avgResponseMs: number
  totalTokens: number
  avgTokensPerCall: number
}

export interface CallRecord {
  id: string
  timestamp: number
  type: ModelType
  modelName: string
  success: boolean
  responseMs: number
  tokens: number
}

export class Metrics {
  private readonly byKey = new Map<string, MetricState>()
  private readonly callRecords: CallRecord[] = []
  private readonly maxRecords = 1000

  update(type: ModelType, modelName: string, ok: boolean, responseMs: number, tokens = 0): void {
    const key = `${type}:${modelName}`
    const prev = this.byKey.get(key) ?? {
      total: 0,
      success: 0,
      failure: 0,
      avgResponseMs: 0,
      totalTokens: 0,
      avgTokensPerCall: 0
    }
    const total = prev.total + 1
    const avg = (prev.avgResponseMs * prev.total + responseMs) / total
    const totalTokens = prev.totalTokens + Math.max(0, Math.floor(tokens))

    this.byKey.set(key, {
      total,
      success: prev.success + (ok ? 1 : 0),
      failure: prev.failure + (ok ? 0 : 1),
      avgResponseMs: Math.round(avg),
      totalTokens,
      avgTokensPerCall: Math.round(totalTokens / total)
    })

    this.callRecords.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      timestamp: Date.now(),
      type,
      modelName,
      success: ok,
      responseMs: Math.round(responseMs),
      tokens: Math.max(0, Math.floor(tokens))
    })
    if (this.callRecords.length > this.maxRecords) {
      this.callRecords.length = this.maxRecords
    }
  }

  getAll(): Array<MetricState & { type: ModelType; modelName: string; successRate: number }> {
    const result: Array<MetricState & { type: ModelType; modelName: string; successRate: number }> = []

    for (const [key, state] of this.byKey.entries()) {
      const [type, modelName] = key.split(':') as [ModelType, string]
      result.push({
        ...state,
        type,
        modelName,
        successRate: state.total === 0 ? 0 : Number(((state.success / state.total) * 100).toFixed(2))
      })
    }

    return result
  }

  getCallRecords(limit = 100): CallRecord[] {
    return this.callRecords.slice(0, Math.max(1, Math.min(limit, this.maxRecords)))
  }
}
