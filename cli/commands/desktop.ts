import fs from 'node:fs'
import { ConfigManager } from '../../src/config'
import { initCommand } from './init'
import { startCommand } from './start'
import { readPidFile } from '../utils/pidfile'
import { defaultConfigPath } from '../utils/paths'
import { openBrowser } from './ui'

export interface DesktopOptions {
  config?: string
  port?: string
  host?: string
  open?: boolean
  foreground?: boolean
}

export async function desktopCommand(opts: DesktopOptions): Promise<void> {
  const configPath = opts.config?.trim() || defaultConfigPath()

  if (!opts.config?.trim() && !fs.existsSync(configPath)) {
    await initCommand()
  }

  const port = opts.port?.trim() || (await resolvePort(configPath))
  const host = opts.host?.trim()
  const foreground = Boolean(opts.foreground)
  const running = await isServiceRunning()

  if (!running) {
    if (foreground) {
      if (opts.open !== false) {
        setTimeout(() => {
          openBrowser(`http://localhost:${port}`)
        }, 1200)
      }
      await startCommand({
        config: configPath,
        port,
        host,
        daemon: false
      })
      return
    }

    await startCommand({
      config: configPath,
      port,
      host,
      daemon: true
    })
  }

  if (opts.open !== false) {
    openBrowser(`http://localhost:${port}`)
  }
}

async function resolvePort(configPath: string): Promise<string> {
  try {
    const manager = new ConfigManager()
    const config = await manager.load(configPath)
    if (Number.isFinite(config.server.port) && config.server.port > 0) {
      return String(config.server.port)
    }
  } catch {
    // fallback below
  }
  return '8080'
}

async function isServiceRunning(): Promise<boolean> {
  const pid = await readPidFile()
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
