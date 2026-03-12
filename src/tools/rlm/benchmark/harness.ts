import type { BenchmarkDefinition, BenchmarkReport, BenchmarkResult, DatasetItem } from "./types"
import { loadDataset } from "./dataset-loader"
import { runSyncSubcall, type SyncSubcallInput } from "../subcall-runner"

type Clock = () => number

export type EvaluationMode = "smoke" | "full"

export type EvaluationResult = { query: string; expected: string; actual: string; passed: boolean; exact_match: boolean; fuzzy_match: boolean; depth: number; tokens: number; wall_time_ms: number; token_efficiency: number }
export type EvaluationReport = { dataset: string; mode: EvaluationMode; total: number; passed: number; failed: number; accuracy: number; exact_match_accuracy: number; fuzzy_match_accuracy: number; token_efficiency: number; avg_depth: number; avg_tokens: number; wall_time_ms: number; avg_wall_time_ms: number; results: EvaluationResult[] }

export type EvaluationSubcallInput = { item: DatasetItem; mode: EvaluationMode; prompt: string; title: string }
export type EvaluationSubcallOutput = { actual: string; depth?: number; tokens?: number }
type EvaluationSubcall = (input: EvaluationSubcallInput) => Promise<EvaluationSubcallOutput>

type FullSubcallInput = Omit<SyncSubcallInput, "title" | "prompt">

export interface RunEvaluationConfig { dataset: string; mode: EvaluationMode; items?: DatasetItem[]; smokeSubcall?: EvaluationSubcall; fullSubcall?: EvaluationSubcall; fullSubcallInput?: FullSubcallInput; now?: Clock }

const toRate = (value: number, total: number) => (total === 0 ? 0 : value / total)

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4))
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function isFuzzyMatch(expected: string, actual: string): boolean {
  const normalizedExpected = normalize(expected)
  const normalizedActual = normalize(actual)
  if (!normalizedExpected || !normalizedActual) {
    return false
  }
  if (normalizedExpected === normalizedActual) {
    return true
  }
  if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) {
    return true
  }
  const expectedTokens = normalizedExpected.split(" ")
  const actualTokens = new Set(normalizedActual.split(" "))
  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length
  return matched / expectedTokens.length >= 0.6
}

function buildPrompt(item: DatasetItem): string {
  return [
    "Answer the query using only the provided context.",
    `Query: ${item.query}`,
    `Context: ${item.context}`,
  ].join("\n\n")
}

function createFullSubcall(input?: FullSubcallInput): EvaluationSubcall {
  if (!input) {
    throw new Error("Full evaluation requires fullSubcall or fullSubcallInput")
  }
  return async ({ prompt, title }) => {
    const result = await runSyncSubcall({ ...input, title, prompt })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return { actual: result.textOutput, tokens: estimateTokens(result.textOutput) }
  }
}

const defaultSmokeSubcall = async ({ item }: EvaluationSubcallInput): Promise<EvaluationSubcallOutput> => ({ actual: item.expected_answer ?? "", depth: 0 })

export async function runEvaluation(config: RunEvaluationConfig): Promise<EvaluationReport> {
  const now = config.now ?? (() => performance.now())
  const startedAt = now()
  const items = config.items ?? await loadDataset(config.dataset, config.mode)
  const execute = config.mode === "smoke"
    ? (config.smokeSubcall ?? defaultSmokeSubcall)
    : (config.fullSubcall ?? createFullSubcall(config.fullSubcallInput))
  const results: EvaluationResult[] = []

  for (const item of items) {
    const itemStartedAt = now()
    const expected = item.expected_answer ?? ""
    const response = await execute({
      item,
      mode: config.mode,
      prompt: buildPrompt(item),
      title: `RLM benchmark ${item.id}`,
    })
    const actual = response.actual.trim()
    const exactMatch = expected.length > 0 && normalize(expected) === normalize(actual)
    const fuzzyMatch = expected.length > 0 && isFuzzyMatch(expected, actual)
    const tokens = response.tokens ?? estimateTokens(actual)
    const expectedTokens = expected ? estimateTokens(expected) : 0
    results.push({
      query: item.query,
      expected,
      actual,
      passed: fuzzyMatch,
      exact_match: exactMatch,
      fuzzy_match: fuzzyMatch,
      depth: response.depth ?? 0,
      tokens,
      wall_time_ms: now() - itemStartedAt,
      token_efficiency: expectedTokens === 0 ? 0 : Math.min(expectedTokens / Math.max(tokens, 1), 1),
    })
  }

  const passed = results.filter((result) => result.passed).length
  const exactMatches = results.filter((result) => result.exact_match).length
  const fuzzyMatches = results.filter((result) => result.fuzzy_match).length
  const sum = <K extends keyof EvaluationResult>(key: K) => results.reduce((total, result) => total + Number(result[key]), 0)
  return {
    dataset: config.dataset,
    mode: config.mode,
    total: results.length,
    passed,
    failed: results.length - passed,
    accuracy: toRate(fuzzyMatches, results.length),
    exact_match_accuracy: toRate(exactMatches, results.length),
    fuzzy_match_accuracy: toRate(fuzzyMatches, results.length),
    token_efficiency: toRate(sum("token_efficiency"), results.length),
    avg_depth: toRate(sum("depth"), results.length),
    avg_tokens: toRate(sum("tokens"), results.length),
    wall_time_ms: now() - startedAt,
    avg_wall_time_ms: toRate(sum("wall_time_ms"), results.length),
    results,
  }
}

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
