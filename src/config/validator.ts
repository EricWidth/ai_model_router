import Ajv, { ErrorObject } from 'ajv'
import { configSchema } from './schema'
import { AppConfig } from '../types'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export class ConfigValidator {
  private readonly ajv = new Ajv({ allErrors: true })
  private readonly validateFn = this.ajv.compile(configSchema)

  validate(config: unknown): ValidationResult {
    const valid = this.validateFn(config)
    if (valid) {
      return { valid: true, errors: [] }
    }

    return {
      valid: false,
      errors: this.mapErrors(this.validateFn.errors ?? [])
    }
  }

  assert(config: unknown): AppConfig {
    const result = this.validate(config)
    if (!result.valid) {
      throw new Error(`Invalid configuration: ${result.errors.join('; ')}`)
    }
    return config as AppConfig
  }

  private mapErrors(errors: ErrorObject[]): string[] {
    return errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
  }
}
