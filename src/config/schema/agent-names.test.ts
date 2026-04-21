import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema disabled_skills", () => {
  test("accepts review-work and ai-slop-remover", () => {
    // given
    const config = {
      disabled_skills: ["review-work", "ai-slop-remover"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_skills).toEqual([
        "review-work",
        "ai-slop-remover",
      ])
    }
  })

  test("accepts user-installed skill names (not just builtins)", () => {
    // given
    const config = {
      disabled_skills: [
        "qs-anti-patterns",
        "my-custom-skill",
        "frontend/nextjs",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_skills).toEqual([
        "qs-anti-patterns",
        "my-custom-skill",
        "frontend/nextjs",
      ])
    }
  })

  test("rejects empty strings", () => {
    // given
    const config = { disabled_skills: [""] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects whitespace-only strings", () => {
    // given
    const config = { disabled_skills: ["   ", "\t\n"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema disabled_commands", () => {
  test("accepts builtin command names", () => {
    // given
    const config = { disabled_commands: ["init-deep", "refactor"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_commands).toEqual(["init-deep", "refactor"])
    }
  })

  test("accepts user-defined command names (not just builtins)", () => {
    // given
    const config = { disabled_commands: ["my-custom-command", "review-pr"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_commands).toEqual([
        "my-custom-command",
        "review-pr",
      ])
    }
  })

  test("rejects empty strings", () => {
    // given
    const config = { disabled_commands: [""] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects whitespace-only strings", () => {
    // given
    const config = { disabled_commands: ["  "] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema other disabled_* fields parity", () => {
  test("disabled_agents rejects whitespace-only strings", () => {
    // given
    const config = { disabled_agents: [" ", "\t"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("disabled_hooks rejects whitespace-only strings", () => {
    // given
    const config = { disabled_hooks: ["\n"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("disabled_tools rejects whitespace-only strings", () => {
    // given
    const config = { disabled_tools: ["   "] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("disabled_agents accepts valid names", () => {
    // given
    const config = { disabled_agents: ["my-agent", "another-agent"] }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_agents).toEqual(["my-agent", "another-agent"])
    }
  })
})
