import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeB64JsonImage, writeB64JsonImage } from './image-base64'

test('decodeB64JsonImage decodes data URL and infers extension', () => {
  const b64 = Buffer.from('hello-image').toString('base64')
  const decoded = decodeB64JsonImage(`data:image/jpeg;base64,${b64}`)

  assert.equal(decoded.mimeType, 'image/jpeg')
  assert.equal(decoded.extension, 'jpg')
  assert.equal(decoded.buffer.toString('utf8'), 'hello-image')
})

test('writeB64JsonImage writes decoded bytes to target file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amr-image-'))
  const outputPath = path.join(dir, 'result.png')
  const b64 = Buffer.from('binary-content').toString('base64')

  const result = await writeB64JsonImage(b64, { outputPath })

  assert.equal(result.outputPath, outputPath)
  assert.equal(result.mimeType, undefined)
  assert.ok(result.bytes > 0)

  const content = await fs.readFile(outputPath)
  assert.equal(content.toString('utf8'), 'binary-content')
})
