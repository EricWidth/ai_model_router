import crypto from 'node:crypto'

export interface SignedUrlParams {
  exp: number
  sig: string
}

export function createSignedImageParams(
  secret: string,
  fileName: string,
  ttlSeconds: number,
  nowMs = Date.now()
): SignedUrlParams {
  const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : 600
  const exp = Math.floor(nowMs / 1000) + safeTtlSeconds
  const sig = sign(secret, fileName, exp)
  return { exp, sig }
}

export function verifySignedImageParams(
  secret: string,
  fileName: string,
  exp: number,
  sig: string,
  nowMs = Date.now()
): boolean {
  if (!secret || !fileName || !sig) return false
  if (!Number.isFinite(exp)) return false
  const expInt = Math.floor(exp)
  const now = Math.floor(nowMs / 1000)
  if (expInt < now) return false

  const expected = sign(secret, fileName, expInt)
  const sigBytes = Buffer.from(sig)
  const expectedBytes = Buffer.from(expected)
  if (sigBytes.length !== expectedBytes.length) return false
  return crypto.timingSafeEqual(sigBytes, expectedBytes)
}

function sign(secret: string, fileName: string, exp: number): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${fileName}:${exp}`)
    .digest('base64url')
}
