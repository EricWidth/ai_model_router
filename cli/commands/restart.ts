import { startCommand, StartOptions } from './start'
import { stopCommand } from './stop'

export async function restartCommand(opts: StartOptions): Promise<void> {
  await stopCommand()
  await startCommand(opts)
}
