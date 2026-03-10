import fs from 'node:fs'
import { ConfigManager } from '../../src/config'
import { defaultConfigPath } from '../utils/paths'

export async function validateCommand(config?: string): Promise<void> {
  const explicit = config?.trim()
  const userDefault = defaultConfigPath()
  const file = explicit || (fs.existsSync(userDefault) ? userDefault : 'examples/config.yaml')
  const manager = new ConfigManager()
  await manager.load(file)
  console.log(`配置校验通过: ${file}`)
}
