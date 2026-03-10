import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { AppConfig } from '../types'

export async function saveConfigToFile(configPath: string, config: AppConfig): Promise<void> {
  const ext = path.extname(configPath).toLowerCase()
  const content =
    ext === '.json' ? JSON.stringify(config, null, 2) : yaml.dump(config, { noRefs: true, lineWidth: 120 })
  await fs.writeFile(configPath, content, 'utf8')
}
