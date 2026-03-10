import { ModelType, SwitchConfig } from '../types'
import { ModelPool } from './model-pool'

export interface SwitchResult<T> {
  modelName: string
  result: T
}

export class SwitchStrategy {
  constructor(private readonly modelPool: ModelPool, private readonly config: SwitchConfig) {}

  async execute<T>(type: ModelType, executor: (modelName: string) => Promise<T>): Promise<SwitchResult<T>> {
    const tried = new Set<string>()
    let lastError: Error | null = null
    const initialAvailable = this.modelPool.getAvailableModels(type)
    const maxAttempts = Math.max(this.config.maxRetries, initialAvailable.length)

    for (let i = 0; i < maxAttempts; i += 1) {
      const nextModel = this.modelPool.getAvailableModels(type).find((name) => !tried.has(name))
      if (!nextModel) {
        if (tried.size === 0) {
          const summary = this.modelPool.getStateSummary(type)
          throw new Error(`No available ${type} models. States: ${summary}`)
        }
        break
      }

      tried.add(nextModel)

      try {
        const result = await executor(nextModel)
        this.modelPool.recordSuccess(type, nextModel)
        return { modelName: nextModel, result }
      } catch (error) {
        lastError = error as Error
        if (this.isRecoverable(error)) {
          this.modelPool.recordFailure(type, nextModel)
          continue
        }
        this.modelPool.markUnavailable(type, nextModel)
        continue
      }
    }

    throw new Error(`All ${type} models failed. Last error: ${lastError?.message ?? 'unknown'}`)
  }

  private isRecoverable(error: unknown): boolean {
    const message = (error as Error).message?.toLowerCase() ?? ''
    return ['rate limit', 'timeout', 'quota', 'exceeded', 'unavailable'].some((token) => message.includes(token))
  }
}
