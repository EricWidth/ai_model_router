import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { logFilePath } from './paths'
import { writePidFile } from './pidfile'
import { getServeProcessSpec } from './serve-process'

export async function startDaemon(configPath: string, port?: string, host?: string): Promise<number> {
  const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
  const pid = isPackaged
    ? await startPackagedDaemon(configPath, port, host)
    : await startNodeDaemon(configPath, port, host)
  await writePidFile(pid)
  return pid
}

async function startNodeDaemon(configPath: string, port?: string, host?: string): Promise<number> {
  const out = await fs.open(logFilePath(), 'a')
  try {
    const serve = getServeProcessSpec()
    const child = spawn(serve.command, serve.args, {
      detached: true,
      stdio: ['ignore', out.fd, out.fd],
      env: {
        ...process.env,
        AMR_INTERNAL_MODE: 'server',
        AMR_CONFIG: configPath,
        ...(port ? { AMR_PORT: port } : {}),
        ...(host ? { AMR_HOST: host } : {})
      }
    })
    child.unref()
    return child.pid!
  } finally {
    await out.close().catch(() => undefined)
  }
}

async function startPackagedDaemon(configPath: string, port?: string, host?: string): Promise<number> {
  const binary = process.execPath
  const pkgInfo = (process as NodeJS.Process & { pkg?: { entrypoint?: string } }).pkg
  const entrypoint = pkgInfo?.entrypoint
  const logPath = logFilePath()

  if (process.platform === 'win32') {
    const ps = [
      `$env:AMR_INTERNAL_MODE='server'`,
      `$env:AMR_CONFIG='${escapePowerShell(configPath)}'`,
      port ? `$env:AMR_PORT='${escapePowerShell(port)}'` : '',
      host ? `$env:AMR_HOST='${escapePowerShell(host)}'` : '',
      `$p=Start-Process -FilePath '${escapePowerShell(binary)}' -ArgumentList ${toPowerShellArgList(entrypoint)} -RedirectStandardOutput '${escapePowerShell(logPath)}' -RedirectStandardError '${escapePowerShell(logPath)}' -WindowStyle Hidden -PassThru`,
      '$p.Id'
    ]
      .filter(Boolean)
      .join('; ')
    const output = await runAndCollect('powershell', ['-NoProfile', '-Command', ps])
    return parsePid(output)
  }

  const shellCmd = [
    `AMR_INTERNAL_MODE=server`,
    `AMR_CONFIG=${shellQuote(configPath)}`,
    port ? `AMR_PORT=${shellQuote(port)}` : '',
    host ? `AMR_HOST=${shellQuote(host)}` : '',
    `${shellQuote(binary)}${entrypoint ? ` ${shellQuote(entrypoint)} _` : ''} >> ${shellQuote(logPath)} 2>&1 &`
  ]
    .filter(Boolean)
    .join(' ')
  await runAndCollect('sh', ['-c', shellCmd])
  await sleep(300)
  return await findLatestUnixPid(binary)
}

async function runAndCollect(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `Failed to start daemon: ${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}

function parsePid(value: string): number {
  const pid = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(pid) || pid < 1) {
    throw new Error(`Invalid daemon PID: ${value}`)
  }
  return pid
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function toPowerShellArgList(entrypoint?: string): string {
  if (!entrypoint) return "'_'"
  return `'${escapePowerShell(entrypoint)}','_'`
}

async function findLatestUnixPid(binaryPath: string): Promise<number> {
  const output = await runAndCollect('ps', ['-ax', '-o', 'pid=,command='])
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const marker = binaryPath
  const candidates = lines
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) return null
      const pid = Number.parseInt(match[1], 10)
      const command = match[2]
      if (!command.includes(marker)) return null
      return pid
    })
    .filter((pid): pid is number => typeof pid === 'number' && Number.isFinite(pid) && pid > 0)

  if (candidates.length === 0) {
    throw new Error('Failed to detect daemon process PID')
  }

  return Math.max(...candidates)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
