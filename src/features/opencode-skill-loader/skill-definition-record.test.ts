import { describe, expect, it } from "bun:test"
import type { LoadedSkill } from "./types"
import { skillsToCommandDefinitionRecord } from "./skill-definition-record"

function makeSkill(partial: Partial<LoadedSkill> & { name: string }): LoadedSkill {
  return {
    scope: "user",
    definition: {
      name: partial.name,
      description: `desc ${partial.name}`,
      template: `template ${partial.name}`,
    },
    ...partial,
  }
}

describe("skillsToCommandDefinitionRecord - spec-default (hideNestedByDefault: false)", () => {
  it("includes top-level skills by default", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "frontend" }),
      makeSkill({ name: "backend" }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills)

    // then
    expect(Object.keys(record).sort()).toEqual(["backend", "frontend"])
  })

  it("includes nested skills under flat name when user-invocable is unset (spec default true)", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "top-level", depth: 0 }),
      makeSkill({ name: "parent/child", depth: 1, flatName: "child" }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills)

    // then
    expect(Object.keys(record).sort()).toEqual(["child", "top-level"])
  })

  it("hides any skill (top-level or nested) with user-invocable: false", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "visible" }),
      makeSkill({ name: "hidden-top", userInvocable: false }),
      makeSkill({
        name: "parent/hidden-child",
        depth: 1,
        flatName: "hidden-child",
        userInvocable: false,
      }),
      makeSkill({
        name: "parent/visible-child",
        depth: 1,
        flatName: "visible-child",
      }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills)

    // then
    expect(Object.keys(record).sort()).toEqual(["visible", "visible-child"])
  })
})

describe("skillsToCommandDefinitionRecord - OmO inversion (hideNestedByDefault: true)", () => {
  it("hides nested skills whose user-invocable is unset", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "top-level" }),
      makeSkill({ name: "parent/child", depth: 1, flatName: "child" }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills, {
      hideNestedByDefault: true,
    })

    // then - nested is hidden, top-level unaffected
    expect(Object.keys(record).sort()).toEqual(["top-level"])
  })

  it("still shows nested skills that opt in with user-invocable: true", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "top-level" }),
      makeSkill({
        name: "parent/opted-in",
        depth: 1,
        flatName: "opted-in",
        userInvocable: true,
      }),
      makeSkill({
        name: "parent/hidden-by-default",
        depth: 1,
        flatName: "hidden-by-default",
      }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills, {
      hideNestedByDefault: true,
    })

    // then - opted-in nested visible under flat name; other hidden
    expect(Object.keys(record).sort()).toEqual(["opted-in", "top-level"])
  })

  it("leaves top-level skills unaffected regardless of the flag", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({ name: "top-a" }),
      makeSkill({ name: "top-b" }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills, {
      hideNestedByDefault: true,
    })

    // then
    expect(Object.keys(record).sort()).toEqual(["top-a", "top-b"])
  })
})

describe("skillsToCommandDefinitionRecord - collision handling", () => {
  it("falls back to prefixed path when two nested skills collide on flat name", () => {
    // given
    const skills: LoadedSkill[] = [
      makeSkill({
        name: "security/auth-patterns",
        depth: 1,
        flatName: "auth-patterns",
      }),
      makeSkill({
        name: "quality-standard/auth-patterns",
        depth: 1,
        flatName: "auth-patterns",
      }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills)

    // then - first wins the flat key, second falls back to prefixed
    expect(Object.keys(record).sort()).toEqual([
      "auth-patterns",
      "quality-standard/auth-patterns",
    ])
  })

  it("yields to a top-level skill that owns the same flat name regardless of iteration order", () => {
    // given - nested appears before top-level in input array
    const skills: LoadedSkill[] = [
      makeSkill({
        name: "security/auth-patterns",
        depth: 1,
        flatName: "auth-patterns",
      }),
      makeSkill({ name: "auth-patterns" }),
    ]

    // when
    const record = skillsToCommandDefinitionRecord(skills)

    // then - top-level owns flat slot, nested takes prefixed path
    expect(Object.keys(record).sort()).toEqual([
      "auth-patterns",
      "security/auth-patterns",
    ])
  })
})
