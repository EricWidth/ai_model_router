import {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelType
} from '../types'

export interface ModelAdapter {
  readonly name: string
  readonly provider: string
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
  chatStream(request: ChatCompletionRequest): Promise<Response>
  speech(request: AudioSpeechRequest): Promise<Buffer>
  image(request: ImageGenerationRequest): Promise<ImageGenerationResponse>
  consumeLearnedMaxTokens?(): number | undefined
  healthCheck(): Promise<void>
  getType(): ModelType
}

export abstract class BaseAdapter implements ModelAdapter {
  constructor(
    public readonly name: string,
    public readonly provider: string,
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly timeout = 30000,
    protected readonly maxTokens?: number
  ) {}

  abstract chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
  abstract chatStream(request: ChatCompletionRequest): Promise<Response>
  abstract speech(request: AudioSpeechRequest): Promise<Buffer>
  abstract image(request: ImageGenerationRequest): Promise<ImageGenerationResponse>
  abstract getType(): ModelType

  async healthCheck(): Promise<void> {
    await this.chat({ messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
  }

  protected async request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {})
        },
        signal: controller.signal
      })

      if (!response.ok) {
        const body = await response.text()
        if (response.status === 401) throw new Error('Invalid API key')
        if (response.status === 429) throw new Error('Rate limit exceeded')
        throw new Error(`Provider error (${response.status}): ${body}`)
      }

      return response
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
