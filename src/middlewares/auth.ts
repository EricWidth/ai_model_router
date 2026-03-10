import { NextFunction, Request, Response } from 'express'
import { sendOpenAIError } from './error'

type ApiKeyResolver = string | (() => string | undefined) | undefined

function resolveApiKey(resolver: ApiKeyResolver): string | undefined {
  if (typeof resolver === 'function') return resolver()
  return resolver
}

export function adminAuth(apiKeyResolver?: ApiKeyResolver) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = resolveApiKey(apiKeyResolver)
    if (!apiKey) {
      next()
      return
    }

    const value = req.header('x-amr-admin-key')
    if (value !== apiKey) {
      sendOpenAIError(res, 401, 'Unauthorized', 'authentication_error')
      return
    }

    next()
  }
}

export function accessAuth(apiKeyResolver?: ApiKeyResolver) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = resolveApiKey(apiKeyResolver)
    if (!apiKey) {
      next()
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
