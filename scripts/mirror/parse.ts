// Checks for JSON the mirror reads (mirror.config.json and upstream
// snapshots), so a shape change fails with the file and field that changed
// rather than as a TypeError deep in the pipeline.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const KEBAB = /^[a-z0-9-]+$/

export class Shape {
  readonly where: string

  constructor(where: string) {
    this.where = where
  }

  fail(message: string): never {
    throw new Error(`${this.where}: ${message}`)
  }

  record(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) this.fail(`${path} must be an object`)
    return value
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value === '') this.fail(`${path} must be a non-empty string`)
    return value
  }

  strings(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) this.fail(`${path} must be an array`)
    return value.map((item, i) => this.string(item, `${path}[${i}]`))
  }

  stringRecord(value: unknown, path: string): Record<string, string> {
    const record = this.record(value, path)
    for (const [key, item] of Object.entries(record)) this.string(item, `${path}.${key}`)
    return record as Record<string, string>
  }
}
