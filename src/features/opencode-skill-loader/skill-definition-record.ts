import type { CommandDefinition } from "../claude-code-command-loader/types"
import { log } from "../../shared/logger"
import type { LoadedSkill } from "./types"

export interface SkillsToCommandDefinitionRecordOptions {
  /**
   * OmO-level override. When true, nested skills that do NOT set an
   * explicit user-invocable value in frontmatter are hidden from the
   * slash-command picker (inverts the Claude Code spec default of
   * user-invocable: true for the nested case only). Frontmatter with
   * an explicit true or false always wins. Top-level skills are never
   * affected by this option.
   */
  hideNestedByDefault?: boolean
}

export function skillsToCommandDefinitionRecord(
  skills: LoadedSkill[],
  options: SkillsToCommandDefinitionRecordOptions = {},
): Record<string, CommandDefinition> {
  const hideNestedByDefault = options.hideNestedByDefault ?? false
  const result: Record<string, CommandDefinition> = {}
  const keyAssignedTo = new Map<string, string>()

  const topLevel: LoadedSkill[] = []
  const nested: LoadedSkill[] = []
  for (const skill of skills) {
    if ((skill.depth ?? 0) > 0) {
      nested.push(skill)
    } else {
      topLevel.push(skill)
    }
  }

  for (const skill of topLevel) {
    if (!isVisibleInSlash(skill, false)) continue
    registerSkill(result, keyAssignedTo, skill.name, skill)
  }

  for (const skill of nested) {
    if (!isVisibleInSlash(skill, hideNestedByDefault)) continue
    const slashKey = resolveNestedSlashKey(skill, keyAssignedTo)
    registerSkill(result, keyAssignedTo, slashKey, skill)
  }

  return result
}

function isVisibleInSlash(
  skill: LoadedSkill,
  hideNestedByDefault: boolean,
): boolean {
  if (skill.userInvocable === false) return false
  if (skill.userInvocable === true) return true
  const isNested = (skill.depth ?? 0) > 0
  return !(isNested && hideNestedByDefault)
}

function registerSkill(
  result: Record<string, CommandDefinition>,
  keyAssignedTo: Map<string, string>,
  slashKey: string,
  skill: LoadedSkill,
): void {
  const existingOwner = keyAssignedTo.get(slashKey)
  if (existingOwner !== undefined && existingOwner !== skill.name) {
    log(
      `Skill slash-key conflict: '${slashKey}' was registered by '${existingOwner}' and is being overwritten by '${skill.name}'`,
    )
  }
  const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = skill.definition
  result[slashKey] = openCodeCompatible as CommandDefinition
  keyAssignedTo.set(slashKey, skill.name)
}

function resolveNestedSlashKey(
  skill: LoadedSkill,
  keyAssignedTo: Map<string, string>,
): string {
  if (!skill.flatName) {
    return skill.name
  }

  const flat = skill.flatName
  const existingOwner = keyAssignedTo.get(flat)
  if (existingOwner === undefined || existingOwner === skill.name) {
    return flat
  }

  log(
    `Flat slash name collision for nested skill '${flat}' (owners: '${existingOwner}' and '${skill.name}'); falling back to prefixed path for '${skill.name}'`,
  )
  return skill.name
}
