import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { resolveMultipleSkillsAsync } from "../../features/opencode-skill-loader/skill-content"
import { discoverSkills } from "../../features/opencode-skill-loader"

export async function resolveSkillContent(
  skills: string[],
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider, disabledSkills?: Set<string>, directory?: string }
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  const allSkills = await discoverSkills({ includeClaudeCodePaths: true, directory: options?.directory })
  const modelDisabled = skills.filter((name) => {
    const match = allSkills.find((skill) => skill.name === name)
    return match?.disableModelInvocation === true
  })
  if (modelDisabled.length > 0) {
    return {
      content: undefined,
      contents: [],
      error:
        `Cannot load skills via task(load_skills=[...]): ${modelDisabled.join(", ")} ` +
        `${modelDisabled.length === 1 ? "has" : "have"} disable-model-invocation: true set in SKILL.md frontmatter. ` +
        `These skills can only be invoked by the user via the slash-command menu.`,
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
