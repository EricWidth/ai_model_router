import { AdapterFactory } from '../adapters/factory'
import { ModelAdapter } from '../adapters/base'
import { AppConfig, ModelConfig, ModelType } from '../types'

export class AdapterRegistry {
  private readonly adapters = new Map<string, ModelAdapter>()
  private readonly modelsByType = new Map<ModelType, Set<string>>()
  private readonly factory: AdapterFactory

  constructor(config: AppConfig, factory = new AdapterFactory()) {
    this.factory = factory
    this.reload(config)
  }

  get(name: string): ModelAdapter {
    const adapter = this.adapters.get(name)
    if (!adapter) throw new Error(`Adapter not found for model: ${name}`)
    return adapter
  }

  getByType(type: ModelType): string[] {
    return Array.from(this.modelsByType.get(type) ?? [])
  }

  reload(config: AppConfig): void {
    this.adapters.clear()
    this.modelsByType.clear()

    ;(['text', 'voice', 'image'] as ModelType[]).forEach((type) => {
      this.modelsByType.set(type, new Set<string>())
      for (const model of config.models[type]) {
        this.upsert(type, model)
      }
    })
  }

  upsert(type: ModelType, model: ModelConfig): void {
    if (model.enabled === false) {
      this.remove(type, model.name)
      return
    }
    const adapter = this.factory.createAdapter(model)
    this.adapters.set(model.name, adapter)
    if (!this.modelsByType.has(type)) {
      this.modelsByType.set(type, new Set<string>())
    }
    this.modelsByType.get(type)?.add(model.name)
  }

  remove(type: ModelType, modelName: string): void {
    this.adapters.delete(modelName)
    this.modelsByType.get(type)?.delete(modelName)
  }
}
