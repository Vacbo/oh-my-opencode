/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { RlmErrorCode } from "../../../features/rlm-context/error-codes"
import { RlmBenchmarkRunner } from "./harness"
import { benchmarkPatterns } from "./patterns"

const runner = new RlmBenchmarkRunner()
const patternByName = new Map(benchmarkPatterns.map((pattern) => [pattern.name, pattern]))

describe("RLM benchmark harness", () => {
  it("benchmark split-map-reduce records split/map/reduce metrics", async () => {
    const result = await runner.run(patternByName.get("Split-Map-Reduce")!)
    expect(result.passed).toBe(true)
    expect(result.opsCount).toBe(4)
    expect(result.depthReached).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.details?.chunkCount).toBe(3)
  })

  it("benchmark recursive decomposition reaches nested depth", async () => {
    const result = await runner.run(patternByName.get("Recursive Decomposition")!)
    expect(result.passed).toBe(true)
    expect(result.opsCount).toBe(9)
    expect(result.depthReached).toBe(2)
    expect(result.details?.deletedSessions).toBe(6)
  })

  it("benchmark variable pipeline chains exec probe exec finish", async () => {
    const result = await runner.run(patternByName.get("Variable Pipeline")!)
    expect(result.passed).toBe(true)
    expect(result.opsCount).toBe(4)
    expect(result.depthReached).toBe(0)
    expect(result.details?.finalAnswer).toBe("summary:LINE-ONE")
  })

  it("benchmark error recovery preserves typed error codes", async () => {
    const result = await runner.run(patternByName.get("Error Recovery")!)
    expect(result.passed).toBe(true)
    expect(result.opsCount).toBe(3)
    expect(result.depthReached).toBe(0)
    expect(result.details?.codes).toEqual([
      RlmErrorCode.INVALID_INPUT,
      RlmErrorCode.INVALID_PATTERN,
      RlmErrorCode.INVALID_RANGE,
    ])
  })

  it("benchmark runner aggregates the paper evaluation suite", async () => {
    const report = await runner.runAll(benchmarkPatterns)
    expect(report.passedCount).toBe(4)
    expect(report.failedCount).toBe(0)
    expect(report.results.map((result) => result.name)).toEqual([
      "Split-Map-Reduce",
      "Recursive Decomposition",
      "Variable Pipeline",
      "Error Recovery",
    ])
  })
})
