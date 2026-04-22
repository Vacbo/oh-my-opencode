/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  getAgentToolRestrictions,
  getAgentToolRestrictionsForSpawn,
  hasAgentToolRestrictions,
  isSubagentRecursionAllowed,
} from "./agent-tool-restrictions"
import type { SubagentRecursionConfig } from "../config/schema/experimental"

describe("getAgentToolRestrictions (baseline, unchanged)", () => {
  it("returns the exploration denylist for explore", () => {
    expect(getAgentToolRestrictions("explore")).toEqual({
      write: false,
      edit: false,
      task: false,
      call_omo_agent: false,
    })
  })

  it("returns the exploration denylist for librarian", () => {
    expect(getAgentToolRestrictions("librarian")).toEqual({
      write: false,
      edit: false,
      task: false,
      call_omo_agent: false,
    })
  })

  it("returns the leaf denylist for oracle", () => {
    expect(getAgentToolRestrictions("oracle")).toEqual({
      write: false,
      edit: false,
      task: false,
      call_omo_agent: false,
    })
  })

  it("returns empty restrictions for unknown agents", () => {
    expect(getAgentToolRestrictions("custom-agent")).toEqual({})
    expect(hasAgentToolRestrictions("custom-agent")).toBe(false)
  })
})

describe("isSubagentRecursionAllowed", () => {
  it("returns false when recursionConfig is undefined (feature off by default)", () => {
    expect(isSubagentRecursionAllowed("explore", undefined)).toBe(false)
  })

  it("returns false when enabled is false", () => {
    expect(isSubagentRecursionAllowed("explore", { enabled: false })).toBe(false)
  })

  it("returns false when enabled is undefined", () => {
    expect(isSubagentRecursionAllowed("explore", {})).toBe(false)
  })

  it("returns true for explore when enabled with default allowed_agents", () => {
    expect(isSubagentRecursionAllowed("explore", { enabled: true })).toBe(true)
  })

  it("returns true for librarian when enabled with default allowed_agents", () => {
    expect(isSubagentRecursionAllowed("librarian", { enabled: true })).toBe(true)
  })

  it("returns false for oracle when enabled with default allowed_agents (oracle is leaf)", () => {
    expect(isSubagentRecursionAllowed("oracle", { enabled: true })).toBe(false)
  })

  it("returns false for unknown agents when enabled with default allowed_agents", () => {
    expect(isSubagentRecursionAllowed("custom-agent", { enabled: true })).toBe(false)
  })

  it("respects explicit allowed_agents override", () => {
    const config: SubagentRecursionConfig = { enabled: true, allowed_agents: ["oracle"] }
    expect(isSubagentRecursionAllowed("oracle", config)).toBe(true)
    expect(isSubagentRecursionAllowed("explore", config)).toBe(false)
  })

  it("is case-insensitive", () => {
    const config: SubagentRecursionConfig = { enabled: true, allowed_agents: ["EXPLORE"] }
    expect(isSubagentRecursionAllowed("explore", config)).toBe(true)
    expect(isSubagentRecursionAllowed("Explore", config)).toBe(true)
    expect(isSubagentRecursionAllowed("EXPLORE", config)).toBe(true)
  })

  it("strips invisible agent characters before matching", () => {
    const config: SubagentRecursionConfig = { enabled: true }
    expect(isSubagentRecursionAllowed("\u200Bexplore", config)).toBe(true)
  })

  it("normalizes invisibles and whitespace in allowed_agents entries", () => {
    const config: SubagentRecursionConfig = {
      enabled: true,
      allowed_agents: ["\u200BExplore ", " \u200Boracle\u200B"],
    }
    expect(isSubagentRecursionAllowed("explore", config)).toBe(true)
    expect(isSubagentRecursionAllowed("oracle", config)).toBe(true)
    expect(isSubagentRecursionAllowed("librarian", config)).toBe(false)
  })

  it("empty allowed_agents list disables all agents even when enabled is true", () => {
    const config: SubagentRecursionConfig = { enabled: true, allowed_agents: [] }
    expect(isSubagentRecursionAllowed("explore", config)).toBe(false)
    expect(isSubagentRecursionAllowed("librarian", config)).toBe(false)
  })
})

describe("getAgentToolRestrictionsForSpawn", () => {
  it("matches getAgentToolRestrictions when recursion is disabled", () => {
    expect(getAgentToolRestrictionsForSpawn("explore", undefined)).toEqual(
      getAgentToolRestrictions("explore"),
    )
    expect(getAgentToolRestrictionsForSpawn("librarian", { enabled: false })).toEqual(
      getAgentToolRestrictions("librarian"),
    )
  })

  it("strips call_omo_agent from explore restrictions when recursion is enabled", () => {
    const result = getAgentToolRestrictionsForSpawn("explore", { enabled: true })
    expect(result).toEqual({
      write: false,
      edit: false,
      task: false,
    })
    expect(result.call_omo_agent).toBeUndefined()
  })

  it("strips call_omo_agent from librarian restrictions when recursion is enabled", () => {
    const result = getAgentToolRestrictionsForSpawn("librarian", { enabled: true })
    expect(result.call_omo_agent).toBeUndefined()
    expect(result.task).toBe(false)
  })

  it("keeps task: false even when recursion is enabled (task bypasses the budget)", () => {
    const result = getAgentToolRestrictionsForSpawn("explore", { enabled: true })
    expect(result.task).toBe(false)
  })

  it("does NOT strip call_omo_agent for oracle even when enabled (oracle is leaf)", () => {
    const result = getAgentToolRestrictionsForSpawn("oracle", { enabled: true })
    expect(result.call_omo_agent).toBe(false)
  })

  it("does NOT strip anything for unknown agents (they had no restrictions to strip)", () => {
    expect(getAgentToolRestrictionsForSpawn("custom-agent", { enabled: true })).toEqual({})
  })

  it("honors explicit allowed_agents override: oracle gets recursion", () => {
    const result = getAgentToolRestrictionsForSpawn("oracle", {
      enabled: true,
      allowed_agents: ["oracle"],
    })
    expect(result.call_omo_agent).toBeUndefined()
  })

  it("honors explicit allowed_agents override: explore does NOT get recursion if not listed", () => {
    const result = getAgentToolRestrictionsForSpawn("explore", {
      enabled: true,
      allowed_agents: ["oracle"],
    })
    expect(result.call_omo_agent).toBe(false)
  })
})
