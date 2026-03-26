import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanupExpiredGeneratedImages,
  normalizeImageGenerationResponse,
  resolveSignedUrlTtlSeconds
} from './image-normalizer'

function createReqMock(host = 'localhost:8080') {
  return {
    protocol: 'http',
    get(name: string): string | undefined {
      if (name.toLowerCase() === 'host') return host
      return undefined
    }
  } as any
}

test('normalizeImageGenerationResponse keeps existing url unchanged', async () => {
  const result = await normalizeImageGenerationResponse(
    {
      created: Date.now(),
      data: [{ url: 'https://example.com/a.png' }]
    },
    createReqMock()
  )

  assert.equal(result.data[0].url, 'https://example.com/a.png')
  assert.equal(result.data[0].b64_json, undefined)
})

test('normalizeImageGenerationResponse converts b64_json to hosted url', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-generated-image-'))
  const payload = Buffer.from('image-bytes').toString('base64')

  const result = await normalizeImageGenerationResponse(
    {
      created: Date.now(),
      data: [{ b64_json: payload }]
    },
    createReqMock('127.0.0.1:8080'),
    { outputDir: dir }
  )

  const url = result.data[0].url
  assert.ok(typeof url === 'string' && url.startsWith('http://127.0.0.1:8080/_generated/images/'))
  assert.equal(result.data[0].b64_json, undefined)

  const fileName = decodeURIComponent(String(url).split('/').pop() || '')
  const filePath = path.join(dir, fileName)
  const content = await fs.readFile(filePath)
  assert.equal(content.toString('utf8'), 'image-bytes')
})

test('normalizeImageGenerationResponse prefers configured publicBaseUrl', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-generated-image-public-base-'))
  const payload = Buffer.from('image-bytes').toString('base64')

  const result = await normalizeImageGenerationResponse(
    {
      created: Date.now(),
      data: [{ b64_json: payload }]
    },
    createReqMock('127.0.0.1:8080'),
    { outputDir: dir, publicBaseUrl: 'https://img.example.com/' }
  )

  const url = result.data[0].url
  assert.ok(typeof url === 'string' && url.startsWith('https://img.example.com/_generated/images/'))
})

test('normalizeImageGenerationResponse appends signed query when secret provided', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-generated-image-signed-'))
  const payload = Buffer.from('image-bytes').toString('base64')

  const result = await normalizeImageGenerationResponse(
    {
      created: Date.now(),
      data: [{ b64_json: payload }]
    },
    createReqMock('127.0.0.1:8080'),
    { outputDir: dir, signedUrlSecret: 'test-secret', signedUrlTtlSeconds: 600 }
  )

  const url = String(result.data[0].url || '')
  assert.ok(url.includes('exp='))
  assert.ok(url.includes('sig='))
})

test('cleanupExpiredGeneratedImages removes only expired files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-generated-cleanup-'))
  const oldFile = path.join(dir, 'old.png')
  const freshFile = path.join(dir, 'fresh.png')

  await fs.writeFile(oldFile, 'old')
  await fs.writeFile(freshFile, 'fresh')

  const now = Date.now()
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000)
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000)
  await fs.utimes(oldFile, twoHoursAgo, twoHoursAgo)
  await fs.utimes(freshFile, tenMinutesAgo, tenMinutesAgo)

  const result = await cleanupExpiredGeneratedImages(dir, 60 * 60 * 1000, now)
  assert.equal(result.deleted, 1)

  await assert.rejects(() => fs.stat(oldFile))
  const freshContent = await fs.readFile(freshFile, 'utf8')
  assert.equal(freshContent, 'fresh')
})

test('resolveSignedUrlTtlSeconds reads ttl from environment when override absent', () => {
  const previous = process.env.AMR_SIGNED_IMAGE_URL_TTL_SECONDS
  process.env.AMR_SIGNED_IMAGE_URL_TTL_SECONDS = '123'
  try {
    assert.equal(resolveSignedUrlTtlSeconds(), 123)
  } finally {
    if (previous === undefined) {
      delete process.env.AMR_SIGNED_IMAGE_URL_TTL_SECONDS
    } else {
      process.env.AMR_SIGNED_IMAGE_URL_TTL_SECONDS = previous
    }
  }
})
