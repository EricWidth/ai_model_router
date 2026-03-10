import fs from 'node:fs/promises'
import { configDir, defaultConfigPath } from '../utils/paths'
import { DEFAULT_CONFIG_TEMPLATE } from '../utils/default-config'

export async function initCommand(): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  const file = defaultConfigPath()
  const exists = await fs.readFile(file, 'utf8').then(() => true).catch(() => false)

  if (exists) {
    console.log(`配置已存在: ${file}`)
    return
  }

  await fs.writeFile(file, DEFAULT_CONFIG_TEMPLATE, 'utf8')
  console.log(`已初始化配置: ${file}`)
}
