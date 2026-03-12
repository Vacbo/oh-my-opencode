export interface BenchmarkDefinition {
  name: string
  execute(): Promise<BenchmarkExecutionResult>
}

export interface BenchmarkExecutionResult {
  opsCount: number
  depthReached: number
  passed?: boolean
  details?: Record<string, unknown>
  accuracy?: number
}

export interface BenchmarkResult {
  name: string
  passed: boolean
  durationMs: number
  opsCount: number
  depthReached: number
  details?: Record<string, unknown>
  error?: string
  accuracy?: number
}

export interface BenchmarkReport {
  results: BenchmarkResult[]
  durationMs: number
  passedCount: number
  failedCount: number
  averageAccuracy?: number
}

export interface DatasetItem {
  id: string
  query: string
  context: string
  expected_answer?: string
  metadata?: Record<string, unknown>
}

export interface DatasetLoader {
  name: string
  size: number
  load(): Promise<DatasetItem[]>
}
