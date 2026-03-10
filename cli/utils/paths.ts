import os from 'node:os'
import path from 'node:path'

export function homedir(): string {
  return os.homedir()
}

export function configDir(): string {
  return path.join(homedir(), '.amr')
}

export function defaultConfigPath(): string {
  return path.join(configDir(), 'config.yaml')
}

export function pidFilePath(): string {
  return path.join(configDir(), 'amr.pid')
}

export function logFilePath(): string {
  return path.join(configDir(), 'amr.log')
}
