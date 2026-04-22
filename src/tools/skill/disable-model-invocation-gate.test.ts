/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createSkillTool } from "./tools"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function createSkill(name: string, disableModelInvocation?: boolean): LoadedSkill {
  // scope: "config" lets extractSkillTemplate return the in-memory
  // template without hitting the filesystem, so the test works without
  // writing real SKILL.md files.
  return {
    name,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `Test skill body for ${name}`,
    },
    scope: "config",
    disableModelInvocation,
  }
}

describe("skill tool - disable-model-invocation gate", () => {
  it("throws when a skill with disableModelInvocation: true is invoked via the skill tool", async () => {
    // given a skill marked as disable-model-invocation: true
    const blocked = createSkill("blocked-skill", true)
    const tool = createSkillTool({ skills: [blocked], commands: [] })

    // when the model tries to invoke it via the skill tool
    const attempt = tool.execute({ name: "blocked-skill" }, undefined)

    // then the tool rejects with an explicit error naming the frontmatter flag
    await expect(attempt).rejects.toThrow(/disable-model-invocation: true/)
    await expect(attempt).rejects.toThrow(/slash-command menu/)
  })

  it("allows invocation when disableModelInvocation is false", async () => {
    // given a skill that explicitly opts into model invocation
    const allowed = createSkill("allowed-skill", false)
    const tool = createSkillTool({ skills: [allowed], commands: [] })

    // when the model invokes it
    const result = await tool.execute({ name: "allowed-skill" }, undefined)

    // then the skill body is returned
    expect(result).toContain("Skill: allowed-skill")
    expect(result).toContain("Test skill body for allowed-skill")
  })

  it("allows invocation when disableModelInvocation is unset (spec default false)", async () => {
    // given a skill without the flag
    const defaulted = createSkill("defaulted-skill", undefined)
    const tool = createSkillTool({ skills: [defaulted], commands: [] })

    // when the model invokes it
    const result = await tool.execute({ name: "defaulted-skill" }, undefined)

    // then the skill body is returned
    expect(result).toContain("Skill: defaulted-skill")
  })

  it("reports the blocked skill name in the error even when multiple skills are available", async () => {
    // given a mix of blocked and allowed skills
    const blocked = createSkill("restricted-tool", true)
    const allowed = createSkill("open-tool", false)
    const tool = createSkillTool({ skills: [blocked, allowed], commands: [] })

    // when the model tries to invoke the blocked one
    const attempt = tool.execute({ name: "restricted-tool" }, undefined)

    // then the error names the specific skill
    await expect(attempt).rejects.toThrow(/restricted-tool/)
  })
})
