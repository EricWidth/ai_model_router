import fs from 'node:fs'
import { startDaemon } from '../utils/daemon'
import { defaultConfigPath } from '../utils/paths'
import { startServer } from '../../src/index'

export interface StartOptions {
  config: string
  port?: string
  host?: string
  daemon: boolean
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const configPath = resolveConfigPath(opts.config)
  const port = opts.port?.trim()
  const host = opts.host?.trim()

  if (opts.daemon) {
    const pid = await startDaemon(configPath, port, host)
    console.log(`服务已后台启动，PID=${pid}`)
    return
  }

  process.env.AMR_CONFIG = configPath
  if (port) process.env.AMR_PORT = port
  if (host) process.env.AMR_HOST = host
  process.env.AMR_INTERNAL_MODE = 'server'
  await startServer()
}

function resolveConfigPath(input?: string): string {
  const explicit = input?.trim()
  if (explicit) return explicit

  const userDefault = defaultConfigPath()
  if (fs.existsSync(userDefault)) return userDefault

  return 'examples/config.yaml'
}
