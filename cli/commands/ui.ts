import { spawn } from 'node:child_process'

export interface UiOptions {
  port: string
  open: boolean
}

export async function uiCommand(opts: UiOptions): Promise<void> {
  const url = `http://localhost:${opts.port}`
  console.log(url)
  if (opts.open) {
    openBrowser(url)
  }
}

export function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}
