import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultConfigPath } from '../utils/paths'

export async function exportCommand(output?: string): Promise<void> {
  const target = output || path.resolve(process.cwd(), 'amr-config-export.yaml')
  const source = defaultConfigPath()
  const content = await fs.readFile(source, 'utf8')
  await fs.writeFile(target, content, 'utf8')
  console.log(target)
}
