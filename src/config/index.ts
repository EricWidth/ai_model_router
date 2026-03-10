import { AppConfig } from '../types'
import { ConfigLoader } from './loader'
import { ConfigValidator } from './validator'

export class ConfigManager {
  private config: AppConfig | null = null
  private loader: ConfigLoader | null = null
  private readonly validator = new ConfigValidator()

  async load(filePath: string): Promise<AppConfig> {
    this.loader = new ConfigLoader(filePath)
    const raw = await this.loader.load()
    this.config = this.validator.assert(raw)
    return this.config
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Configuration is not loaded')
    }
    return this.config
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.getConfig()[key]
  }

  async reload(): Promise<AppConfig> {
    if (!this.loader) {
      throw new Error('Configuration loader is not initialized')
    }
    const raw = await this.loader.load()
    this.config = this.validator.assert(raw)
    return this.config
  }
}
