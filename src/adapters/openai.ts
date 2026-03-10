import { BaseAdapter } from './base'
import {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelType
} from '../types'

export class OpenAIAdapter extends BaseAdapter {
  getType(): ModelType {
    if (this.name.startsWith('tts-')) return 'voice'
    if (this.name.startsWith('dall-e') || this.name.startsWith('gpt-image')) return 'image'
    return 'text'
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(this.buildChatPayload(request, false))
    })
    return (await response.json()) as ChatCompletionResponse
  }

  async chatStream(request: ChatCompletionRequest): Promise<Response> {
    return this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(this.buildChatPayload(request, true))
    })
  }

  async speech(request: AudioSpeechRequest): Promise<Buffer> {
    const response = await this.request('/audio/speech', {
      method: 'POST',
      body: JSON.stringify({ ...request, model: this.name })
    })
    return Buffer.from(await response.arrayBuffer())
  }

  async image(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const response = await this.request('/images/generations', {
      method: 'POST',
      body: JSON.stringify({ ...request, model: this.name })
    })
    return (await response.json()) as ImageGenerationResponse
  }

  private buildChatPayload(request: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...(request as unknown as Record<string, unknown>) }
    if (!stream) {
      delete payload.stream_options
    }
    this.normalizeMaxTokens(payload)
    payload.stream = stream
    payload.model = this.name
    return payload
  }

  private normalizeMaxTokens(payload: Record<string, unknown>): void {
    const providerLimit = Number.POSITIVE_INFINITY
    const modelLimit = this.getModelMaxTokens()
    const configuredLimit = Math.min(providerLimit, modelLimit)
    const hasRequestValue = Object.prototype.hasOwnProperty.call(payload, 'max_tokens')

    if (!hasRequestValue) {
      if (Number.isFinite(configuredLimit)) {
        payload.max_tokens = configuredLimit
      }
      return
    }

    const value = Number(payload.max_tokens)
    if (!Number.isFinite(value)) {
      delete payload.max_tokens
      return
    }

    const intValue = Math.floor(value)
    if (intValue < 1) {
      delete payload.max_tokens
      return
    }

    if (Number.isFinite(configuredLimit)) {
      payload.max_tokens = Math.min(intValue, configuredLimit)
      return
    }

    payload.max_tokens = intValue
  }

  private getModelMaxTokens(): number {
    if (!Number.isFinite(this.maxTokens) || (this.maxTokens as number) < 1) {
      return Number.POSITIVE_INFINITY
    }
    return Math.floor(this.maxTokens as number)
  }
}
