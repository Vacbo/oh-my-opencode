import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { resolveMultipleSkillsAsync, getAllSkills } from "../../features/opencode-skill-loader/skill-content"

export async function resolveSkillContent(
  skills: string[],
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider, disabledSkills?: Set<string>, directory?: string }
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  const allSkills = await getAllSkills(options)
  const skillsByNameLower = new Map(allSkills.map((skill) => [skill.name.toLowerCase(), skill]))

  const modelDisabled = skills.filter((name) => {
    const match = skillsByNameLower.get(name.toLowerCase())
    return match?.disableModelInvocation === true
  })
  if (modelDisabled.length > 0) {
    return {
      content: undefined,
      contents: [],
      error:
        `Cannot load skills via task(load_skills=[...]): ${modelDisabled.join(", ")} ` +
        `${modelDisabled.length === 1 ? "has" : "have"} disable-model-invocation: true set in SKILL.md frontmatter. ` +
        `Model-initiated invocation is blocked for these skills. If a skill is also user-invocable, the user can still trigger it from the slash-command menu.`,
    }
  }

  const { resolved, notFound } = await resolveMultipleSkillsAsync(skills, options)
  if (notFound.length > 0) {
    const available = allSkills.map((s) => s.name).join(", ")
    return { content: undefined, contents: [], error: `Skills not found: ${notFound.join(", ")}. Available: ${available}` }
  }

  const contents = Array.from(resolved.values())
  return { content: contents.join("\n\n"), contents, error: null }
}
