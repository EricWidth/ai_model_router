import { readPidFile } from '../utils/pidfile'

export async function statusCommand(): Promise<void> {
  const pid = await readPidFile()
  if (!pid) {
    console.log('服务状态: stopped')
    return
  }

  try {
    process.kill(pid, 0)
    console.log(`服务状态: running (PID=${pid})`)
  } catch {
    console.log('服务状态: stale pid')
  }
}
