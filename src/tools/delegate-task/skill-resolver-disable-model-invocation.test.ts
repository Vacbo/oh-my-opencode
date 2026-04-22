/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveSkillContent } from "./skill-resolver"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-content"

function writeSkill(
  root: string,
  slug: string,
  body: string,
): void {
  const dir = join(root, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), body)
}

describe("resolveSkillContent - disable-model-invocation gate", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    clearSkillCache()
  })

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    clearSkillCache()
  })

  function setupSkillsDir(): { directory: string; skillsRoot: string } {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-skill-resolver-dmi-"))
    tempDirs.push(tempDir)
    const directory = join(tempDir, "project")
    const skillsRoot = join(directory, ".opencode", "skills")
    mkdirSync(skillsRoot, { recursive: true })
    return { directory, skillsRoot }
  }

  // Pass a non-empty disabledSkills set so getAllSkills bypasses the
  // module-level cache that can be populated by other test files in the
  // same bun-test run. The sentinel name never matches a real skill.
  const cacheBypassOptions = { disabledSkills: new Set(["__test_cache_bypass__"]) }

  it("returns an error when load_skills names a skill with disable-model-invocation: true", async () => {
    // given a project skill that blocks model invocation
    const { directory, skillsRoot } = setupSkillsDir()
    writeSkill(
      skillsRoot,
      "user-only",
      `---\nname: user-only\ndescription: User only\ndisable-model-invocation: true\n---\nBody\n`,
    )

    // when the task layer tries to load it
    const result = await resolveSkillContent(["user-only"], { directory, ...cacheBypassOptions })

    // then the resolver rejects with a specific error
    expect(result.content).toBeUndefined()
    expect(result.error).toMatch(/disable-model-invocation: true/)
    expect(result.error).toMatch(/user-only/)
    expect(result.error).toMatch(/slash-command menu/)
  })

  it("allows skills whose disable-model-invocation is false or absent", async () => {
    // given two normally-invocable skills
    const { directory, skillsRoot } = setupSkillsDir()
    writeSkill(
      skillsRoot,
      "allowed-skill",
      `---\nname: allowed-skill\ndescription: Allowed\ndisable-model-invocation: false\n---\nAllowed body\n`,
    )
    writeSkill(
      skillsRoot,
      "default-skill",
      `---\nname: default-skill\ndescription: Default\n---\nDefault body\n`,
    )

    // when resolving both
    const result = await resolveSkillContent(["allowed-skill", "default-skill"], { directory, ...cacheBypassOptions })

    // then the resolver succeeds with both contents
    expect(result.error).toBeNull()
    expect(result.contents).toHaveLength(2)
    expect(result.content).toContain("Allowed body")
    expect(result.content).toContain("Default body")
  })

  it("rejects the whole batch when any requested skill is model-disabled", async () => {
    // given one allowed skill and one blocked skill
    const { directory, skillsRoot } = setupSkillsDir()
    writeSkill(
      skillsRoot,
      "allowed-skill",
      `---\nname: allowed-skill\ndescription: Allowed\n---\nAllowed body\n`,
    )
    writeSkill(
      skillsRoot,
      "blocked-skill",
      `---\nname: blocked-skill\ndescription: Blocked\ndisable-model-invocation: true\n---\nBlocked body\n`,
    )

    // when the model requests both
    const result = await resolveSkillContent(["allowed-skill", "blocked-skill"], { directory, ...cacheBypassOptions })

    // then the resolver refuses the whole batch and names the blocked skill
    expect(result.content).toBeUndefined()
    expect(result.contents).toHaveLength(0)
    expect(result.error).toMatch(/blocked-skill/)
    expect(result.error).not.toMatch(/allowed-skill.*has disable-model-invocation/)
  })
})
