import fs from 'node:fs/promises'
import path from 'node:path'
import { RuntimeStateSnapshot, TokenUsageSnapshot } from './model-pool'

interface RuntimeStateFile {
  tokenUsage?: TokenUsageSnapshot
  runtimeState?: RuntimeStateSnapshot
}

export class RuntimeStateStore {
  private readonly statePath: string
  private saveTimer: NodeJS.Timeout | null = null
  private pendingSnapshot: RuntimeStateSnapshot | null = null
  private writing = false

  constructor(configPath: string) {
    this.statePath = `${configPath}.state.json`
  }

  async load(): Promise<Partial<RuntimeStateFile>> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8')
      return JSON.parse(content) as RuntimeStateFile
    } catch {
      return {}
    }
  }

  scheduleSave(snapshot: RuntimeStateSnapshot): void {
    this.pendingSnapshot = snapshot
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      void this.flushSave()
    }, 300)
  }

  async flushSave(): Promise<void> {
    if (this.writing || !this.pendingSnapshot) return
    this.writing = true
    const snapshot = this.pendingSnapshot
    this.pendingSnapshot = null

    try {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true })
      await fs.writeFile(this.statePath, JSON.stringify({ runtimeState: snapshot }, null, 2), 'utf8')
    } finally {
      this.writing = false
      if (this.pendingSnapshot) {
        await this.flushSave()
      }
    }
  }
}
