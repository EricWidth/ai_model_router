import fs from 'node:fs/promises'
import { logFilePath } from '../utils/paths'

export interface LogsOptions {
  follow?: boolean
  tail?: string
}

export async function logsCommand(opts: LogsOptions): Promise<void> {
  const file = logFilePath()
  const tail = Number.parseInt(opts.tail || '100', 10)
  const safeTail = Number.isFinite(tail) && tail > 0 ? tail : 100
  const content = await fs.readFile(file, 'utf8').catch(() => '')
  const lines = content.split('\n').filter(Boolean)
  console.log(lines.slice(-safeTail).join('\n'))

  if (opts.follow) {
    await followLogs(file, Buffer.byteLength(content))
    return
  }
}

async function followLogs(file: string, initialOffset: number): Promise<void> {
  let offset = initialOffset
  process.stdout.write(`\n[follow] ${file}\n`)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const stat = await fs.stat(file)
      if (stat.size < offset) {
        offset = stat.size
      } else if (stat.size > offset) {
        const handle = await fs.open(file, 'r')
        try {
          const length = stat.size - offset
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await handle.read(buffer, 0, length, offset)
          if (bytesRead > 0) {
            process.stdout.write(buffer.subarray(0, bytesRead).toString('utf8'))
            offset += bytesRead
          }
        } finally {
          await handle.close()
        }
      }
    } catch {
      // ignore read errors and retry
    }

    await delay(1000)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
