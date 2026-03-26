import { ModelType } from '../types'

export type UnifiedTaskType = 'chat' | 'embeddings' | 'speech' | 'image_generation'

export type GatewayTaskName = 'chat' | 'embed' | 'speech' | 'generate'

export interface GatewayTaskHints {
  routeCategory?: ModelType
  modality?: 'text' | 'image' | 'audio' | 'vector'
  operation?: 'chat' | 'embeddings' | 'speech' | 'image_generation'
}

export interface GatewayTaskRequest {
  sessionKey?: string
  task: GatewayTaskName
  input: Record<string, unknown>
  hints?: GatewayTaskHints
}

export interface UnifiedTask {
  taskType: UnifiedTaskType
  routeCategory: ModelType
  stream: boolean
}

export function createUnifiedTaskFromGatewayRequest(request: GatewayTaskRequest): UnifiedTask {
  const hints = request.hints ?? {}
  if (hints.routeCategory) {
    return createUnifiedTask(hints.routeCategory, request.input)
  }

  if (request.task === 'embed' || hints.operation === 'embeddings' || hints.modality === 'vector') {
    return createUnifiedTask('vector', request.input)
  }

  if (request.task === 'speech' || hints.operation === 'speech') {
    return createUnifiedTask('voice', request.input)
  }

  if (request.task === 'generate' && (hints.operation === 'image_generation' || hints.modality === 'image')) {
    return createUnifiedTask('visual', request.input)
  }

  if (request.task === 'chat') {
    return createUnifiedTask('llm', request.input)
  }

  return createUnifiedTask('llm', request.input)
}

export function createUnifiedTask(routeCategory: ModelType, body: Record<string, unknown>): UnifiedTask {
  if (routeCategory === 'vector') {
    return {
      taskType: 'embeddings',
      routeCategory,
      stream: false
    }
  }

  if (routeCategory === 'voice') {
    return {
      taskType: 'speech',
      routeCategory,
      stream: false
    }
  }

  if (routeCategory === 'visual' && isImageGenerationRequest(body)) {
    return {
      taskType: 'image_generation',
      routeCategory,
      stream: false
    }
  }

  return {
    taskType: 'chat',
    routeCategory,
    stream: body.stream !== false
  }
}

function isImageGenerationRequest(body: Record<string, unknown>): boolean {
  const hasPrompt = typeof body.prompt === 'string' && body.prompt.trim().length > 0
  const hasGenerationHint =
    typeof body.size === 'string' ||
    typeof body.quality === 'string' ||
    typeof body.n === 'number' ||
    (typeof body.task === 'string' && body.task.toLowerCase().includes('image_generation'))
  return hasPrompt && hasGenerationHint
}
