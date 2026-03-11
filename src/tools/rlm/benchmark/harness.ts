import type {
  BenchmarkDefinition,
  BenchmarkReport,
  BenchmarkResult,
} from "./types"

type Clock = () => number

export class RlmBenchmarkRunner {
  constructor(private readonly now: Clock = () => performance.now()) {}

  async run(definition: BenchmarkDefinition): Promise<BenchmarkResult> {
    const startedAt = this.now()

    try {
      const execution = await definition.execute()
      return {
        name: definition.name,
        passed: execution.passed ?? true,
        durationMs: this.now() - startedAt,
        opsCount: execution.opsCount,
        depthReached: execution.depthReached,
        details: execution.details,
      }
    } catch (error) {
      return {
        name: definition.name,
        passed: false,
        durationMs: this.now() - startedAt,
        opsCount: 0,
        depthReached: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async runAll(definitions: BenchmarkDefinition[]): Promise<BenchmarkReport> {
    const startedAt = this.now()
    const results: BenchmarkResult[] = []

    for (const definition of definitions) {
      results.push(await this.run(definition))
    }

    const passedCount = results.filter((result) => result.passed).length
    return {
      results,
      durationMs: this.now() - startedAt,
      passedCount,
      failedCount: results.length - passedCount,
    }
  }
}
