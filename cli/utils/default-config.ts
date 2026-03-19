export const DEFAULT_CONFIG_TEMPLATE = `server:
  port: 8080
  host: 0.0.0.0
  cors: true
  accessApiKey: <YOUR_ACCESS_API_KEY>
  publicModelName: custom-model
models:
  llm:
    - name: gpt-4o-mini
      provider: openai
      apiKey: <YOUR_OPENAI_API_KEY>
      baseUrl: https://api.openai.com/v1
      priority: 1
  visual:
    - name: gpt-image-1
      provider: openai
      apiKey: <YOUR_OPENAI_API_KEY>
      baseUrl: https://api.openai.com/v1
      priority: 1
  multimodal:
    - name: gpt-4o
      provider: openai
      apiKey: <YOUR_OPENAI_API_KEY>
      baseUrl: https://api.openai.com/v1
      priority: 1
  voice:
    - name: tts-1
      provider: openai
      apiKey: <YOUR_OPENAI_API_KEY>
      baseUrl: https://api.openai.com/v1
      priority: 1
  vector: []
switch:
  maxRetries: 3
  cooldown: 60000
  healthCheckInterval: 300000
`
