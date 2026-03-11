export interface BenchmarkDefinition {
  name: string
  execute(): Promise<BenchmarkExecutionResult>
}

export interface BenchmarkExecutionResult {
  opsCount: number
  depthReached: number
  passed?: boolean
  details?: Record<string, unknown>
}

export interface BenchmarkResult {
  name: string
  passed: boolean
  durationMs: number
  opsCount: number
  depthReached: number
  details?: Record<string, unknown>
  error?: string
}

export interface BenchmarkReport {
  results: BenchmarkResult[]
  durationMs: number
  passedCount: number
  failedCount: number
}
