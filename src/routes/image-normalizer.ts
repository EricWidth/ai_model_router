import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Request } from 'express'
import { ImageGenerationResponse } from '../types'
import { decodeB64JsonImage } from '../utils/image-base64'
import { logger } from '../utils/logger'
import { createSignedImageParams } from '../utils/signed-url'

export const GENERATED_IMAGES_ROUTE = '/_generated/images'
const DEFAULT_RETENTION_HOURS = 24
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_SIGNED_URL_TTL_SECONDS = 600
const cleanupStateByDir = new Map<string, { lastRunAt: number; running: boolean }>()

interface NormalizeImageOptions {
  outputDir?: string
  publicBaseUrl?: string
  signedUrlSecret?: string
  signedUrlTtlSeconds?: number
}

export function resolveGeneratedImagesDir(): string {
  return path.resolve(process.cwd(), 'data/generated-images')
}

export async function normalizeImageGenerationResponse(
  result: ImageGenerationResponse,
  req: Request,
  options: NormalizeImageOptions = {}
): Promise<ImageGenerationResponse> {
  if (!Array.isArray(result?.data) || result.data.length === 0) {
    return result
  }

  const outputDir = options.outputDir ? path.resolve(options.outputDir) : resolveGeneratedImagesDir()
  const normalizedData = [] as ImageGenerationResponse['data']

  for (const item of result.data) {
    if (typeof item?.url === 'string' && item.url.trim().length > 0) {
      normalizedData.push(item)
      continue
    }

    if (typeof item?.b64_json !== 'string' || item.b64_json.trim().length === 0) {
      normalizedData.push(item)
      continue
    }

    try {
      const decoded = decodeB64JsonImage(item.b64_json)
      const filename = `img-${Date.now()}-${randomUUID()}.${decoded.extension}`
      const outputPath = path.join(outputDir, filename)
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(outputPath, decoded.buffer)

      const { b64_json: _ignored, ...rest } = item
      normalizedData.push({
        ...rest,
        url: toPublicImageUrl(req, filename, options.publicBaseUrl, options.signedUrlSecret, options.signedUrlTtlSeconds)
      })
    } catch (error) {
      logger.warn(`Failed to normalize b64_json image: ${error instanceof Error ? error.message : String(error)}`)
      normalizedData.push(item)
    }
  }

  triggerCleanupIfNeeded(outputDir)

  return {
    ...result,
    data: normalizedData
  }
}

function toPublicImageUrl(
  req: Request,
  filename: string,
  publicBaseUrl?: string,
  signedUrlSecret?: string,
  signedUrlTtlSeconds?: number
): string {
  const configuredBase = normalizePublicBaseUrl(publicBaseUrl)
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim()
  const protocol = forwardedProto || req.protocol || 'http'
  const host = forwardedHost || req.get('host')
  const relativePath = `${GENERATED_IMAGES_ROUTE}/${encodeURIComponent(filename)}`
  const signedQuery = buildSignedQuery(filename, signedUrlSecret, signedUrlTtlSeconds)
  const relativeWithQuery = `${relativePath}${signedQuery}`
  if (configuredBase) {
    return `${configuredBase}${relativeWithQuery}`
  }
  if (!host) return relativeWithQuery
  return `${protocol}://${host}${relativeWithQuery}`
}

function normalizePublicBaseUrl(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '')
}

function buildSignedQuery(fileName: string, secret?: string, ttlSeconds?: number): string {
  if (!secret) return ''
  const params = createSignedImageParams(secret, fileName, resolveSignedUrlTtlSeconds(ttlSeconds))
  const query = new URLSearchParams({
    exp: String(params.exp),
    sig: params.sig
  })
  return `?${query.toString()}`
}

export function resolveSignedUrlTtlSeconds(override?: number): number {
  if (Number.isFinite(override) && Number(override) > 0) {
    return Math.floor(Number(override))
  }
  const raw = process.env.AMR_SIGNED_IMAGE_URL_TTL_SECONDS
  const envTtl = raw ? Number(raw) : NaN
  if (Number.isFinite(envTtl) && envTtl > 0) {
    return Math.floor(envTtl)
  }
  return DEFAULT_SIGNED_URL_TTL_SECONDS
}

function triggerCleanupIfNeeded(outputDir: string): void {
  const retentionMs = resolveRetentionMs()
  if (!retentionMs) return

  const now = Date.now()
  const state = cleanupStateByDir.get(outputDir) ?? { lastRunAt: 0, running: false }
  if (state.running) return
  if (now - state.lastRunAt < CLEANUP_INTERVAL_MS) return

  cleanupStateByDir.set(outputDir, { ...state, running: true, lastRunAt: now })
  void cleanupExpiredGeneratedImages(outputDir, retentionMs, now)
    .catch((error) => {
      logger.warn(`Failed to cleanup generated images: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      const latest = cleanupStateByDir.get(outputDir)
      if (!latest) return
      cleanupStateByDir.set(outputDir, { ...latest, running: false })
    })
}

function resolveRetentionMs(): number | undefined {
  const rawHours = process.env.AMR_GENERATED_IMAGE_RETENTION_HOURS
  const hours = rawHours ? Number(rawHours) : DEFAULT_RETENTION_HOURS
  if (!Number.isFinite(hours)) return DEFAULT_RETENTION_HOURS * 60 * 60 * 1000
  if (hours <= 0) return undefined
  return Math.floor(hours * 60 * 60 * 1000)
}

export async function cleanupExpiredGeneratedImages(
  outputDir: string,
  retentionMs: number,
  nowMs = Date.now()
): Promise<{ deleted: number }> {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return { deleted: 0 }

  let entries: Array<{ isFile: () => boolean; name: string }>
  try {
    const raw = await fs.readdir(outputDir, { withFileTypes: true })
    entries = raw.map((entry) => ({
      isFile: () => entry.isFile(),
      name: String(entry.name)
    }))
  } catch {
    return { deleted: 0 }
  }

  const cutoff = nowMs - retentionMs
  let deleted = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const filePath = path.join(outputDir, entry.name)
    try {
      const stats = await fs.stat(filePath)
      if (stats.mtimeMs >= cutoff) continue
      await fs.unlink(filePath)
      deleted += 1
    } catch {
      // best effort cleanup
    }
  }

  return { deleted }
}
