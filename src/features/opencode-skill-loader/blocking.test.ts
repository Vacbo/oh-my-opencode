import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { discoverAllSkillsBlocking } from "./blocking"
import type { SkillScope } from "./types"

const TEST_DIR = join(tmpdir(), `blocking-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("discoverAllSkillsBlocking", () => {
  it("returns skills synchronously from valid directories", () => {
    // given a skill directory with a proper SKILL.md entrypoint
    const skillsRoot = join(TEST_DIR, "skills")
    const skillDir = join(skillsRoot, "test-skill")
    mkdirSync(skillDir, { recursive: true })

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill
---
This is test skill content.`
    )

    const dirs = [skillsRoot]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then returns skills synchronously
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("test-skill")
    expect(skills[0].definition.description).toContain("test skill")
  })

  it("returns empty array for empty directories", () => {
    // given empty directory
    const emptyDir = join(TEST_DIR, "empty")
    mkdirSync(emptyDir, { recursive: true })

    const dirs = [emptyDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then returns empty array
    expect(skills).toBeArray()
    expect(skills.length).toBe(0)
  })

  it("returns empty array for non-existent directories", () => {
    // given non-existent directory
    const nonExistentDir = join(TEST_DIR, "does-not-exist")

    const dirs = [nonExistentDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then returns empty array (no throw)
    expect(skills).toBeArray()
    expect(skills.length).toBe(0)
  })

  it("handles multiple directories with mixed content", () => {
    // given two skills roots, each containing one directory skill with SKILL.md
    const dir1 = join(TEST_DIR, "dir1")
    const dir2 = join(TEST_DIR, "dir2")
    mkdirSync(join(dir1, "skill1"), { recursive: true })
    mkdirSync(join(dir2, "skill2"), { recursive: true })

    writeFileSync(
      join(dir1, "skill1", "SKILL.md"),
      `---
name: skill1
description: First skill
---
Skill 1 content.`
    )

    writeFileSync(
      join(dir2, "skill2", "SKILL.md"),
      `---
name: skill2
description: Second skill
---
Skill 2 content.`
    )

    const dirs = [dir1, dir2]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then returns all valid skills
    expect(skills).toBeArray()
    expect(skills.length).toBe(2)

    const skillNames = skills.map(s => s.name).sort()
    expect(skillNames).toEqual(["skill1", "skill2"])
  })

  it("skips invalid YAML files", () => {
    // given a skills root with one valid and one invalid SKILL.md directory
    const skillsRoot = join(TEST_DIR, "skills")
    mkdirSync(join(skillsRoot, "valid-skill"), { recursive: true })
    mkdirSync(join(skillsRoot, "invalid-skill"), { recursive: true })

    writeFileSync(
      join(skillsRoot, "valid-skill", "SKILL.md"),
      `---
name: valid-skill
description: Valid skill
---
Valid skill content.`
    )

    writeFileSync(
      join(skillsRoot, "invalid-skill", "SKILL.md"),
      `---
name: invalid skill
description: [ invalid yaml
---
Invalid content.`
    )

    const dirs = [skillsRoot]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then skips invalid, returns valid
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("valid-skill")
  })

  it("handles directory-based skills with SKILL.md", () => {
    // given directory-based skill structure
    const skillsDir = join(TEST_DIR, "skills")
    const mySkillDir = join(skillsDir, "my-skill")
    mkdirSync(mySkillDir, { recursive: true })

    const skillMdPath = join(mySkillDir, "SKILL.md")
    writeFileSync(
      skillMdPath,
      `---
name: my-skill
description: Directory-based skill
---
This is a directory-based skill.`
    )

    const dirs = [skillsDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then returns skill from SKILL.md
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("my-skill")
  })

  it("processes large skill sets without timeout", () => {
    // given a skills root with many directory-based skills (20+)
    const skillsRoot = join(TEST_DIR, "many-skills")

    const skillCount = 25
    for (let i = 0; i < skillCount; i++) {
      const skillDir = join(skillsRoot, `skill-${i}`)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: skill-${i}
description: Skill number ${i}
---
Content for skill ${i}.`
      )
    }

    const dirs = [skillsRoot]
    const scopes: SkillScope[] = ["opencode-project"]

    // when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // then completes without timeout
    expect(skills).toBeArray()
    expect(skills.length).toBe(skillCount)
  })
})
