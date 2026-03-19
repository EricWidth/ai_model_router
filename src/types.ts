export type ModelType = 'llm' | 'visual' | 'multimodal' | 'voice' | 'vector'
export const MODEL_TYPES: ModelType[] = ['llm', 'visual', 'multimodal', 'voice', 'vector']

export interface ModelConfig {
  id?: string
  name: string
  provider: string
  apiKey: string
  baseUrl?: string
  maxTokens?: number
  maxTokensSource?: 'manual' | 'learned'
  quota?: number
  priority: number
  timeout?: number
  enabled?: boolean
  selected?: boolean
  cooldown?: number
}

export interface ServerConfig {
  port: number
  host: string
  cors?: boolean
  adminApiKey?: string
  accessApiKey?: string
  publicModelName?: string
}

export interface SwitchConfig {
  maxRetries: number
  cooldown: number
  healthCheckInterval: number
}

export interface AppConfig {
  server: ServerConfig
  models: Record<ModelType, ModelConfig[]>
  switch: SwitchConfig
}

export interface ChatCompletionRequest {
  model?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: unknown
    name?: string
  }>
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stream_options?: unknown
  stop?: string | string[]
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
      function_call?: {
        name?: string
        arguments?: string
      }
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface AudioSpeechRequest {
  model?: string
  input: string
  voice: string
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  speed?: number
}

export interface ImageGenerationRequest {
  model?: string
  prompt: string
  n?: number
  size?: string
  quality?: string
}

export interface ImageGenerationResponse {
  created: number
  data: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export interface EmbeddingsRequest {
  model?: string
  input: string | string[] | Array<number> | Array<Array<number>>
  encoding_format?: 'float' | 'base64'
  dimensions?: number
  user?: string
}

export interface EmbeddingsResponse {
  object: 'list'
  data: Array<{
    object: 'embedding'
    embedding: number[] | string
    index: number
  }>
  model: string
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}
