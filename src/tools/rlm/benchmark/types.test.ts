/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type {
  BenchmarkExecutionResult,
  BenchmarkResult,
  BenchmarkReport,
  DatasetLoader,
  DatasetItem,
} from "./types"

describe("Benchmark types - accuracy metrics", () => {
  it("BenchmarkExecutionResult includes optional accuracy field (0-1 float)", () => {
    const result: BenchmarkExecutionResult = {
      opsCount: 5,
      depthReached: 2,
      passed: true,
      accuracy: 0.85,
    }
    expect(result.accuracy).toBe(0.85)
    expect(typeof result.accuracy).toBe("number")
    expect(result.accuracy).toBeGreaterThanOrEqual(0)
    expect(result.accuracy).toBeLessThanOrEqual(1)
  })

  it("BenchmarkExecutionResult accuracy is optional for backward compatibility", () => {
    const result: BenchmarkExecutionResult = {
      opsCount: 3,
      depthReached: 1,
    }
    expect(result.accuracy).toBeUndefined()
  })

  it("BenchmarkResult includes optional accuracy field", () => {
    const result: BenchmarkResult = {
      name: "test-benchmark",
      passed: true,
      durationMs: 1000,
      opsCount: 5,
      depthReached: 2,
      accuracy: 0.92,
    }
    expect(result.accuracy).toBe(0.92)
  })

  it("BenchmarkResult accuracy is optional for backward compatibility", () => {
    const result: BenchmarkResult = {
      name: "test-benchmark",
      passed: true,
      durationMs: 500,
      opsCount: 3,
      depthReached: 1,
    }
    expect(result.accuracy).toBeUndefined()
  })

  it("BenchmarkReport includes optional averageAccuracy field", () => {
    const report: BenchmarkReport = {
      results: [
        {
          name: "test-1",
          passed: true,
          durationMs: 100,
          opsCount: 2,
          depthReached: 0,
          accuracy: 0.8,
        },
        {
          name: "test-2",
          passed: true,
          durationMs: 200,
          opsCount: 3,
          depthReached: 1,
          accuracy: 0.9,
        },
      ],
      durationMs: 300,
      passedCount: 2,
      failedCount: 0,
      averageAccuracy: 0.85,
    }
    expect(report.averageAccuracy).toBe(0.85)
  })

  it("BenchmarkReport averageAccuracy is optional for backward compatibility", () => {
    const report: BenchmarkReport = {
      results: [],
      durationMs: 0,
      passedCount: 0,
      failedCount: 0,
    }
    expect(report.averageAccuracy).toBeUndefined()
  })
})

describe("Benchmark types - DatasetLoader interface", () => {
  it("DatasetItem has required id, query, context fields", () => {
    const item: DatasetItem = {
      id: "item-1",
      query: "What is the capital of France?",
      context: "France is a country in Western Europe...",
    }
    expect(item.id).toBe("item-1")
    expect(item.query).toBe("What is the capital of France?")
    expect(item.context).toBe("France is a country in Western Europe...")
  })

  it("DatasetItem has optional expected_answer field", () => {
    const item: DatasetItem = {
      id: "item-2",
      query: "What is 2+2?",
      context: "Basic arithmetic",
      expected_answer: "4",
    }
    expect(item.expected_answer).toBe("4")
  })

  it("DatasetItem has optional metadata field", () => {
    const item: DatasetItem = {
      id: "item-3",
      query: "Test query",
      context: "Test context",
      metadata: { difficulty: "easy", category: "math" },
    }
    expect(item.metadata).toEqual({ difficulty: "easy", category: "math" })
  })

  it("DatasetLoader has required name, size, and load method", async () => {
    const mockItems: DatasetItem[] = [
      { id: "1", query: "q1", context: "c1" },
      { id: "2", query: "q2", context: "c2" },
    ]

    const loader: DatasetLoader = {
      name: "test-dataset",
      size: 2,
      load: async () => mockItems,
    }

    expect(loader.name).toBe("test-dataset")
    expect(loader.size).toBe(2)
    const items = await loader.load()
    expect(items).toEqual(mockItems)
    expect(items.length).toBe(2)
  })

  it("DatasetLoader load returns Promise<DatasetItem[]>", async () => {
    const loader: DatasetLoader = {
      name: "empty-dataset",
      size: 0,
      load: async () => [],
    }

    const items = await loader.load()
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBe(0)
  })
})