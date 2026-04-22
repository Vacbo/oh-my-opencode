import { describe, expect, test } from "bun:test"

import {
  appendSubagentRecursionPrompt,
  getSubagentRecursionPrompt,
} from "./subagent-recursion-prompt"

describe("subagent recursion prompt helper", () => {
  test("returns undefined when recursion is disabled", () => {
    expect(getSubagentRecursionPrompt("explore", undefined)).toBeUndefined()
    expect(getSubagentRecursionPrompt("explore", { enabled: false })).toBeUndefined()
  })

  test("returns prompt block for explore when enabled by default", () => {
    const block = getSubagentRecursionPrompt("explore", { enabled: true })

    expect(block).toContain("Nested Delegation Available")
    expect(block).toContain("call_omo_agent")
    expect(block).toContain("another delegation or research tool with the same purpose")
    expect(block).toContain("task` remains unavailable")
  })

  test("returns undefined for oracle unless explicitly allowed", () => {
    expect(getSubagentRecursionPrompt("oracle", { enabled: true })).toBeUndefined()
    expect(getSubagentRecursionPrompt("oracle", { enabled: true, allowed_agents: ["oracle"] })).toBeDefined()
  })

  test("appends the block only when allowed", () => {
    const basePrompt = "Base prompt"

    expect(appendSubagentRecursionPrompt(basePrompt, "explore", { enabled: true })).toContain(
      "Nested Delegation Available",
    )
    expect(appendSubagentRecursionPrompt(basePrompt, "oracle", { enabled: true })).toBe(basePrompt)
  })
})
