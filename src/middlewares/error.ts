import { NextFunction, Request, Response } from 'express'

type OpenAIErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'api_error'

export interface AppErrorLike extends Error {
  status?: number
  type?: OpenAIErrorType
  param?: string | null
  code?: string | null
}

export function sendOpenAIError(
  res: Response,
  status: number,
  message: string,
  type: OpenAIErrorType,
  param: string | null = null,
  code: string | null = null
): void {
  res.status(status).json({
    error: {
      message,
      type,
      param,
      code
    }
  })
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appError = error as AppErrorLike
  const message = appError?.message || 'Unknown error'
  const status = Number.isFinite(appError?.status) ? Number(appError.status) : 500
  const type = appError?.type || 'api_error'
  const param = appError?.param ?? null
  const code = appError?.code ?? null

  sendOpenAIError(res, status, message, type, param, code)
}
