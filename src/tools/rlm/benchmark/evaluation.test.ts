/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { loadDataset } from "./dataset-loader"
import { runEvaluation } from "./harness"

describe("runEvaluation", () => {
  it("runs smoke evaluation with deterministic mocked subcalls", async () => {
    const items = await loadDataset("browsecomp", "smoke")
    const answers = new Map<string, string>([
      [items[0]!.id, items[0]!.expected_answer!],
      [items[1]!.id, "Rust"],
      [items[2]!.id, "value for key or default"],
    ])

    const report = await runEvaluation({
      dataset: "browsecomp",
      mode: "smoke",
      smokeSubcall: async ({ item }) => ({ actual: answers.get(item.id) ?? "" }),
    })

    expect(report.total).toBe(3)
    expect(report.passed).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.accuracy).toBeCloseTo(2 / 3, 5)
    expect(report.exact_match_accuracy).toBeCloseTo(1 / 3, 5)
    expect(report.fuzzy_match_accuracy).toBeCloseTo(2 / 3, 5)
    expect(report.avg_depth).toBe(0)
    expect(report.avg_tokens).toBeGreaterThan(0)
    expect(report.wall_time_ms).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(JSON.stringify(report)).results).toHaveLength(3)
  })

  it("uses the full-mode subcall path when requested", async () => {
    const [item] = await loadDataset("browsecomp", "smoke")
    let fullCalls = 0

    const report = await runEvaluation({
      dataset: "browsecomp",
      mode: "full",
      items: [item!],
      smokeSubcall: async () => {
        throw new Error("smoke path should not run")
      },
      fullSubcall: async ({ item: current }) => {
        fullCalls += 1
        return { actual: current.expected_answer ?? "" }
      },
    })

    expect(fullCalls).toBe(1)
    expect(report.total).toBe(1)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.accuracy).toBe(1)
    expect(report.results[0]?.actual).toBe(item?.expected_answer)
  })
})
