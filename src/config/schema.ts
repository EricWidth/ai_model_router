export const configSchema = {
  type: 'object',
  required: ['server', 'models', 'switch'],
  properties: {
    server: {
      type: 'object',
      required: ['port', 'host'],
      properties: {
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        host: { type: 'string' },
        cors: { type: 'boolean' },
        adminApiKey: { type: 'string' },
        accessApiKey: { type: 'string' },
        publicModelName: { type: 'string' }
      },
      additionalProperties: true
    },
    models: {
      type: 'object',
      required: ['text', 'voice', 'image'],
      properties: {
        text: { type: 'array', items: { $ref: '#/definitions/model' } },
        voice: { type: 'array', items: { $ref: '#/definitions/model' } },
        image: { type: 'array', items: { $ref: '#/definitions/model' } }
      },
      additionalProperties: false
    },
    switch: {
      type: 'object',
      required: ['maxRetries', 'cooldown', 'healthCheckInterval'],
      properties: {
        maxRetries: { type: 'integer', minimum: 1 },
        cooldown: { type: 'integer', minimum: 0 },
        healthCheckInterval: { type: 'integer', minimum: 0 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false,
  definitions: {
    model: {
      type: 'object',
      required: ['name', 'provider', 'apiKey', 'priority'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string', minLength: 1 },
        provider: { type: 'string', minLength: 1 },
        apiKey: { type: 'string', minLength: 1 },
        baseUrl: { type: 'string' },
        maxTokens: { type: 'integer', minimum: 1 },
        maxTokensSource: { type: 'string', enum: ['manual', 'learned'] },
        quota: { type: 'integer', minimum: 0 },
        priority: { type: 'integer', minimum: 1 },
        timeout: { type: 'integer', minimum: 1 },
        enabled: { type: 'boolean' },
        selected: { type: 'boolean' },
        cooldown: { type: 'integer', minimum: 0 }
      },
      additionalProperties: true
    }
  }
} as const
