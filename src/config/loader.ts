import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import dotenv from 'dotenv'
import { EnvProcessor } from './env'

export class ConfigLoader {
  private readonly envProcessor = new EnvProcessor()

  constructor(private readonly filePath: string) {}

  async load(): Promise<unknown> {
    this.loadEnvFile()
    const content = await fs.readFile(this.filePath, 'utf8')
    const ext = path.extname(this.filePath).toLowerCase()
    let parsed: unknown

    if (ext === '.yaml' || ext === '.yml') {
      parsed = yaml.load(content)
    } else if (ext === '.json') {
      parsed = JSON.parse(content)
    } else {
      throw new Error(`Unsupported config format: ${ext}`)
    }

    return this.envProcessor.process(parsed)
  }

  private loadEnvFile(): void {
    const envFile = process.env.AMR_ENV_FILE ?? path.resolve(process.cwd(), '.env')
    dotenv.config({ path: envFile })
  }
}
