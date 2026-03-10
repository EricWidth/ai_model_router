import fs from 'node:fs/promises'
import { defaultConfigPath } from '../utils/paths'

export async function importCommand(source: string): Promise<void> {
  const content = await fs.readFile(source, 'utf8')
  await fs.writeFile(defaultConfigPath(), content, 'utf8')
  console.log(defaultConfigPath())
}
