export class EnvProcessor {
  process(input: unknown): unknown {
    if (typeof input === 'string') {
      return this.replaceEnvVars(input)
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.process(item))
    }

    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.process(value)
      }
      return result
    }

    return input
  }

  private replaceEnvVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const envValue = process.env[varName]
      if (envValue === undefined) {
        // Keep unresolved placeholders to avoid hard startup failure on fresh desktop installs.
        return `\${${varName}}`
      }
      return envValue
    })
  }
}
