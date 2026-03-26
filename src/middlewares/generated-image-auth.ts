import { NextFunction, Request, Response } from 'express'
import { sendOpenAIError } from './error'
import { verifySignedImageParams } from '../utils/signed-url'

type ApiKeyResolver = string | (() => string | undefined) | undefined

function resolveApiKey(resolver: ApiKeyResolver): string | undefined {
  if (typeof resolver === 'function') return resolver()
  return resolver
}

export function generatedImageAuth(apiKeyResolver?: ApiKeyResolver) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = resolveApiKey(apiKeyResolver)
    if (!apiKey) {
      next()
      return
    }

    let fileName = ''
    try {
      fileName = decodeURIComponent(String(req.path || '').replace(/^\/+/, ''))
    } catch {
      sendOpenAIError(res, 400, 'Invalid image path', 'invalid_request_error')
      return
    }

    const expRaw = req.query.exp
    const sigRaw = req.query.sig
    const exp = Number(typeof expRaw === 'string' ? expRaw : '')
    const sig = typeof sigRaw === 'string' ? sigRaw : ''
    if (fileName && Number.isFinite(exp) && sig) {
      if (verifySignedImageParams(apiKey, fileName, exp, sig)) {
        next()
        return
      }
      sendOpenAIError(res, 401, 'Invalid or expired signed URL', 'authentication_error')
      return
    }

    const bearer = req.header('authorization')
    const bearerToken = bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : undefined
    const headerToken = req.header('x-api-key')?.trim()
    const token = bearerToken || headerToken
    if (!token || token !== apiKey) {
      sendOpenAIError(res, 401, 'Unauthorized', 'authentication_error')
      return
    }

    next()
  }
}
