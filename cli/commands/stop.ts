import { readPidFile, removePidFile } from '../utils/pidfile'

export async function stopCommand(): Promise<void> {
  const pid = await readPidFile()
  if (!pid) {
    console.log('未发现运行中的服务')
    return
  }

  try {
    process.kill(pid)
    await removePidFile()
    console.log(`服务已停止，PID=${pid}`)
  } catch (error) {
    console.log(`停止失败: ${(error as Error).message}`)
  }
}
