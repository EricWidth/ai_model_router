import { AdapterRegistry } from '../core/adapter-registry'
import { Metrics } from '../core/metrics'
import { ModelPool } from '../core/model-pool'
import { RuntimeEvents } from '../core/runtime-events'
import { SwitchStrategy } from '../core/switch-strategy'
import { AppConfig } from '../types'

export interface AppContext {
  configPath: string
  config: AppConfig
  modelPool: ModelPool
  metrics: Metrics
  switchStrategy: SwitchStrategy
  adapterRegistry: AdapterRegistry
  runtimeEvents: RuntimeEvents
}
