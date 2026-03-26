import fs from 'node:fs/promises'
import path from 'node:path'

export interface WriteB64ImageOptions {
  outputPath?: string
  dir?: string
  basename?: string
}

export interface WriteB64ImageResult {
  outputPath: string
  mimeType?: string
  bytes: number
}

interface DecodedImage {
  buffer: Buffer
  mimeType?: string
  extension: string
}

export async function writeB64JsonImage(
  b64Json: string,
  options: WriteB64ImageOptions = {}
): Promise<WriteB64ImageResult> {
  const decoded = decodeB64JsonImage(b64Json)
  const outputPath = resolveOutputPath(decoded.extension, options)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, decoded.buffer)

  return {
    outputPath,
    mimeType: decoded.mimeType,
    bytes: decoded.buffer.length
  }
}

export function decodeB64JsonImage(b64Json: string): { buffer: Buffer; mimeType?: string; extension: string } {
  const raw = String(b64Json ?? '').trim()
  if (!raw) {
    throw new Error('b64_json is empty')
  }

  const dataUrlMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(raw)
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1].toLowerCase()
    const payload = dataUrlMatch[2]
    return decodePayload(payload, mimeType)
  }

  return decodePayload(raw, undefined)
}

function decodePayload(payload: string, mimeType?: string): DecodedImage {
  const compact = payload.replace(/\s+/g, '')
  let buffer: Buffer
  try {
    buffer = Buffer.from(compact, 'base64')
  } catch {
    throw new Error('invalid base64 image payload')
  }
  if (!buffer.length) {
    throw new Error('invalid base64 image payload')
  }
  return {
    buffer,
    mimeType,
    extension: toExtension(mimeType)
  }
}

function resolveOutputPath(extension: string, options: WriteB64ImageOptions): string {
  if (options.outputPath?.trim()) {
    return path.resolve(options.outputPath)
  }
  const dir = path.resolve(options.dir?.trim() || process.cwd())
  const basename = (options.basename?.trim() || 'image').replace(/[^\w.-]+/g, '_')
  return path.join(dir, `${basename}-${Date.now()}.${extension}`)
}

function toExtension(mimeType?: string): string {
  if (!mimeType) return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/bmp') return 'bmp'
  if (mimeType === 'image/svg+xml') return 'svg'
  return 'png'
}
