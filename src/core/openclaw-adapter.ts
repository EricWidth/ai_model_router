import { GatewayTaskRequest } from './unified-task'
import { ModelType } from '../types'

interface OpenClawAttachment {
  type?: string
  url?: string
}

interface OpenClawRequest {
  sessionKey?: string
  session?: { key?: string }
  action?: string
  input?: Record<string, unknown>
  hints?: {
    routeCategory?: ModelType
    modality?: 'text' | 'image' | 'audio' | 'vector'
    operation?: 'chat' | 'embeddings' | 'speech' | 'image_generation'
  }
}

export function normalizeOpenClawRequest(payload: Record<string, unknown>): GatewayTaskRequest {
  const request = payload as OpenClawRequest
  const sessionKey = typeof request.sessionKey === 'string' ? request.sessionKey : request.session?.key
  const rawInput = request.input && typeof request.input === 'object' ? { ...request.input } : {}
  const normalizedInput = normalizeInput(rawInput)
  const hints = normalizeHints(request.hints, normalizedInput)
  const action = normalizeAction(request.action, hints)

  return {
    sessionKey,
    task: action,
    input: normalizedInput,
    ...(hints ? { hints } : {})
  }
}

function normalizeAction(
  action: unknown,
  hints?: GatewayTaskRequest['hints']
): GatewayTaskRequest['task'] {
  if (hints?.operation === 'speech') return 'speech'
  if (hints?.operation === 'embeddings' || hints?.modality === 'vector') return 'embed'
  if (hints?.operation === 'image_generation') return 'generate'
  const normalized = typeof action === 'string' ? action.trim().toLowerCase() : 'chat'
  if (normalized === 'embed' || normalized === 'speech' || normalized === 'generate') return normalized
  return 'chat'
}

function normalizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input }
  if (typeof normalized.text === 'string' && typeof normalized.input !== 'string' && !Array.isArray(normalized.messages)) {
    normalized.input = normalized.text
  }

  const attachments = Array.isArray(normalized.attachments) ? (normalized.attachments as OpenClawAttachment[]) : []
  if (!Array.isArray(normalized.messages) && (typeof normalized.text === 'string' || attachments.length > 0)) {
    const content: Array<Record<string, unknown>> = []
    if (typeof normalized.text === 'string' && normalized.text.trim()) {
      content.push({ type: 'text', text: normalized.text })
    }
    for (const attachment of attachments) {
      if (attachment?.type === 'image_url' && typeof attachment.url === 'string') {
        content.push({ type: 'image_url', image_url: { url: attachment.url } })
      }
    }
    normalized.messages = content.length > 0 ? [{ role: 'user', content }] : []
  }

  return normalized
}

function normalizeHints(
  hints: OpenClawRequest['hints'],
  input: Record<string, unknown>
): GatewayTaskRequest['hints'] | undefined {
  const routeCategory = hints?.routeCategory ?? inferRouteCategoryFromInput(input)
  const modality = hints?.modality
  const operation = hints?.operation

  if (!routeCategory && !modality && !operation) return undefined

  return {
    ...(routeCategory ? { routeCategory } : {}),
    ...(modality ? { modality } : {}),
    ...(operation ? { operation } : {})
  }
}

function inferRouteCategoryFromInput(input: Record<string, unknown>): ModelType | undefined {
  const messages = input.messages
  if (!Array.isArray(messages)) return undefined

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const type = typeof (item as { type?: unknown }).type === 'string' ? String((item as { type?: unknown }).type) : ''
      if (type.toLowerCase().includes('image')) {
        return 'multimodal'
      }
    }
  }

  return undefined
}
