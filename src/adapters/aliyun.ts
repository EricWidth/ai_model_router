import { BaseAdapter } from './base'
import {
  AudioSpeechRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelType
} from '../types'

type AdaptiveMode = 'exponential' | 'linear' | 'fixed'

interface AdaptiveState {
  mode: AdaptiveMode
  currentMaxTokens: number
  dirtyLearned: boolean
}

export class AliyunAdapter extends BaseAdapter {
  private static readonly PROVIDER_MAX_TOKENS = 8192
  private static readonly BASE_MAX_TOKENS = 4096
  private static readonly LINEAR_STEP = 1024
  private static readonly adaptiveStateByModel = new Map<string, AdaptiveState>()

  getType(): ModelType {
    if (this.name.startsWith('tts-') || this.name.includes('paraformer')) return 'voice'
    if (this.name.includes('wanx') || this.name.includes('image')) return 'visual'
    return 'llm'
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const payload = this.buildChatPayload(request, false)
    const response = await this.requestWithMaxTokensSelfHeal(payload)
    return (await response.json()) as ChatCompletionResponse
  }

  async chatStream(request: ChatCompletionRequest): Promise<Response> {
    const payload = this.buildChatPayload(request, true)
    return this.requestWithMaxTokensSelfHeal(payload)
  }

  async speech(request: AudioSpeechRequest): Promise<Buffer> {
    const response = await this.request('/audio/speech', {
      method: 'POST',
      body: JSON.stringify({ ...request, model: this.name })
    })
    return Buffer.from(await response.arrayBuffer())
  }

  async embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    const response = await this.request('/embeddings', {
      method: 'POST',
      body: JSON.stringify({ ...request, model: this.name })
    })
    return (await response.json()) as EmbeddingsResponse
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

  private async requestWithMaxTokensSelfHeal(payload: Record<string, unknown>): Promise<Response> {
    const firstAttemptMaxTokens = this.toPositiveInt(payload.max_tokens)
    try {
      const response = await this.request('/chat/completions', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      this.handleSuccessfulAttempt(firstAttemptMaxTokens)
      return response
    } catch (error) {
      if (!this.isMaxTokensRangeError(error) || !firstAttemptMaxTokens) {
        throw error
      }

      this.handleExceededAttempt(firstAttemptMaxTokens)
      const retryMaxTokens = this.resolveRetryMaxTokens(firstAttemptMaxTokens)
      if (!retryMaxTokens || retryMaxTokens === firstAttemptMaxTokens) {
        throw error
      }

      const retryPayload = { ...payload, max_tokens: retryMaxTokens }
      try {
        const retryResponse = await this.request('/chat/completions', {
          method: 'POST',
          body: JSON.stringify(retryPayload)
        })
        this.handleSuccessfulAttempt(retryMaxTokens)
        return retryResponse
      } catch (retryError) {
        if (this.isMaxTokensRangeError(retryError)) {
          this.handleExceededAttempt(retryMaxTokens)
        }
        throw retryError
      }
    }
  }

  private normalizeMaxTokens(payload: Record<string, unknown>): void {
    const defaultLimitEnabled = this.shouldApplyDefaultTokenLimit()
    const providerLimit = defaultLimitEnabled ? AliyunAdapter.PROVIDER_MAX_TOKENS : Number.POSITIVE_INFINITY
    const modelLimit = this.getModelMaxTokens()
    const configuredLimit = Math.min(providerLimit, modelLimit)
    const hasRequestValue = Object.prototype.hasOwnProperty.call(payload, 'max_tokens')
    const adaptiveLimit =
      this.shouldUseAdaptiveMaxTokens() && defaultLimitEnabled
        ? this.getAdaptiveMaxTokens()
        : Number.POSITIVE_INFINITY
    const effectiveLimit = Math.min(configuredLimit, adaptiveLimit)

    if (!hasRequestValue) {
      if (Number.isFinite(effectiveLimit)) {
        payload.max_tokens = effectiveLimit
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

    payload.max_tokens = Math.min(intValue, effectiveLimit)
  }

  private isMaxTokensRangeError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    return message.includes('internalerror.algo.invalidparameter') && message.includes('range of max_tokens')
  }

  private getModelMaxTokens(): number {
    if (!Number.isFinite(this.maxTokens) || (this.maxTokens as number) < 1) {
      return Number.POSITIVE_INFINITY
    }
    return Math.floor(this.maxTokens as number)
  }

  private shouldUseAdaptiveMaxTokens(): boolean {
    return !Number.isFinite(this.maxTokens) || (this.maxTokens as number) < 1
  }

  private shouldApplyDefaultTokenLimit(): boolean {
    const type = this.getType()
    return type === 'llm' || type === 'multimodal'
  }

  private getAdaptiveMaxTokens(): number {
    const state = this.getAdaptiveState()
    return Math.min(state.currentMaxTokens, AliyunAdapter.PROVIDER_MAX_TOKENS)
  }

  private getAdaptiveState(): AdaptiveState {
    const existing = AliyunAdapter.adaptiveStateByModel.get(this.name)
    if (existing) return existing

    const initial: AdaptiveState = {
      mode: 'exponential',
      currentMaxTokens: Math.min(AliyunAdapter.BASE_MAX_TOKENS, AliyunAdapter.PROVIDER_MAX_TOKENS),
      dirtyLearned: false
    }
    AliyunAdapter.adaptiveStateByModel.set(this.name, initial)
    return initial
  }

  private handleSuccessfulAttempt(maxTokens: number | undefined): void {
    if (!this.shouldUseAdaptiveMaxTokens()) return
    if (!maxTokens) return

    const state = this.getAdaptiveState()
    if (state.mode === 'fixed') return

    if (maxTokens >= AliyunAdapter.PROVIDER_MAX_TOKENS) {
      state.mode = 'fixed'
      state.currentMaxTokens = AliyunAdapter.PROVIDER_MAX_TOKENS
      state.dirtyLearned = true
      return
    }

    if (state.mode === 'exponential') {
      state.currentMaxTokens = Math.min(maxTokens * 2, AliyunAdapter.PROVIDER_MAX_TOKENS)
      return
    }

    state.currentMaxTokens = Math.min(maxTokens + AliyunAdapter.LINEAR_STEP, AliyunAdapter.PROVIDER_MAX_TOKENS)
  }

  private handleExceededAttempt(maxTokens: number): void {
    if (!this.shouldUseAdaptiveMaxTokens()) return
    const state = this.getAdaptiveState()

    if (state.mode === 'fixed') return

    if (state.mode === 'exponential') {
      state.mode = 'linear'
      state.currentMaxTokens = Math.max(1, Math.floor(maxTokens / 2))
      return
    }

    state.mode = 'fixed'
    state.currentMaxTokens = Math.max(1, maxTokens - AliyunAdapter.LINEAR_STEP)
    state.dirtyLearned = true
  }

  private resolveRetryMaxTokens(lastAttemptMaxTokens: number): number | undefined {
    if (!this.shouldUseAdaptiveMaxTokens()) return undefined
    const candidate = this.getAdaptiveMaxTokens()
    if (!Number.isFinite(candidate) || candidate < 1) return undefined
    if (candidate === lastAttemptMaxTokens) return undefined
    return Math.floor(candidate)
  }

  private toPositiveInt(value: unknown): number | undefined {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return undefined
    const intValue = Math.floor(parsed)
    if (intValue < 1) return undefined
    return intValue
  }

  consumeLearnedMaxTokens(): number | undefined {
    if (!this.shouldUseAdaptiveMaxTokens()) return undefined
    const state = this.getAdaptiveState()
    if (state.mode !== 'fixed' || !state.dirtyLearned) return undefined
    state.dirtyLearned = false
    return state.currentMaxTokens
  }
}
