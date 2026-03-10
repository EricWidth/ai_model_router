import fs from 'node:fs/promises'
import { pidFilePath } from './paths'

export async function writePidFile(pid: number): Promise<void> {
  await fs.writeFile(pidFilePath(), `${pid}`, 'utf8')
}

export async function readPidFile(): Promise<number | null> {
  try {
    const raw = await fs.readFile(pidFilePath(), 'utf8')
    return Number.parseInt(raw, 10)
  } catch {
    return null
  }
}

export async function removePidFile(): Promise<void> {
  await fs.unlink(pidFilePath()).catch(() => undefined)
}
