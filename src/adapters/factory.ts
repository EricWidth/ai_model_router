import { ModelConfig } from '../types'
import { ModelAdapter } from './base'
import { OpenAIAdapter } from './openai'
import { AliyunAdapter } from './aliyun'

export class AdapterFactory {
  createAdapter(config: ModelConfig): ModelAdapter {
    const baseUrl = config.baseUrl?.trim() ? config.baseUrl : this.defaultBaseUrl(config.provider)
    const timeout = config.timeout ?? 30000
    const maxTokens = config.maxTokens

    switch (config.provider.toLowerCase()) {
      case 'openai':
        return new OpenAIAdapter(config.name, 'openai', config.apiKey, baseUrl, timeout, maxTokens)
      case 'aliyun':
        return new AliyunAdapter(config.name, 'aliyun', config.apiKey, baseUrl, timeout, maxTokens)
      default:
        throw new Error(`Unsupported provider: ${config.provider}`)
    }
  }

  private defaultBaseUrl(provider: string): string {
    if (provider === 'openai') return 'https://api.openai.com/v1'
    if (provider === 'aliyun') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    return ''
  }
}
