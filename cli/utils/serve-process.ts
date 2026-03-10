import fs from 'node:fs'
import path from 'node:path'

export interface ServeProcessSpec {
  command: string
  args: string[]
}

export function getServeProcessSpec(): ServeProcessSpec {
  const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)
  if (isPackaged) {
    const binaryPath = resolvePackagedBinaryPath()
    return {
      command: binaryPath,
      args: ['_']
    }
  }

  return {
    command: process.execPath,
    args: [path.resolve(__dirname, '../index.js'), '_']
  }
}

function resolvePackagedBinaryPath(): string {
  const candidates = [process.env.PKG_EXECPATH, process.env._, process.argv[1], process.execPath, process.argv0, process.argv[0]]
  for (const candidate of candidates) {
    if (!isUsableBinaryPath(candidate, true)) continue
    if (fs.existsSync(candidate)) return candidate
  }

  for (const candidate of candidates) {
    if (!isUsableBinaryPath(candidate, false)) continue
    return candidate
  }

  return process.execPath
}

function isUsableBinaryPath(candidate: string | undefined, skipNodeBinary: boolean): candidate is string {
  if (!candidate || candidate.endsWith('.js')) return false
  if (!skipNodeBinary) return true
  const lower = path.basename(candidate).toLowerCase()
  return !(lower === 'node' || lower === 'node.exe')
}
