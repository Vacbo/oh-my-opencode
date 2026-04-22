import type { SubagentRecursionConfig } from "../config/schema/experimental"
import { isSubagentRecursionAllowed } from "../shared/agent-tool-restrictions"

/**
 * Prompt block appended to subagent system prompts when the agent is allowed
 * to spawn nested subagents via call_omo_agent. Only rendered when the agent
 * is listed in experimental.subagent_recursion.allowed_agents (and the feature
 * is enabled). Keeps wording generic so it applies across explore, librarian,
 * and oracle without per-agent customisation.
 */
const RECURSION_INSTRUCTION_BLOCK = `
## Nested Delegation Available

You MAY use \`call_omo_agent\` for nested delegation when your task is broader
than a single search or consultation can cover. If your current tool list
contains another delegation or research tool with the same purpose, you may use
that instead - choose based on the tools you actually have, not on this example
alone. Subagent budgets (max depth, max descendants) are enforced by the
runtime - do not try to work around them.

When to spawn a nested subagent:
- Your task decomposes into 2+ independent research angles that would each
  need their own focused search.
- You need information from a domain outside your specialty (e.g. an
  \`explore\` subagent delegating external-library research to \`librarian\`).
- A single query would either (a) exhaust your context window or (b)
  produce output too noisy to be useful.

When NOT to spawn a nested subagent:
- You can answer the question directly from the tools you already have.
- The work is small and would finish faster than the spawn overhead.
- You would be spawning another agent of your own type just to split a
  search that belongs in one place.

Typical call pattern:
\`\`\`
call_omo_agent(
  subagent_type="explore" | "librarian" | "oracle",
  prompt="<clear, self-contained task with success criteria>",
  run_in_background=true,
  load_skills=[]
)
\`\`\`

\`task\` remains unavailable to you by design. Use whichever equivalent
delegation tool is actually available to you, with \`call_omo_agent\` as the
default path in this environment.
`.trim()

export function getSubagentRecursionPrompt(
  agentName: string,
  recursionConfig: SubagentRecursionConfig | undefined,
): string | undefined {
  if (!isSubagentRecursionAllowed(agentName, recursionConfig)) return undefined
  return RECURSION_INSTRUCTION_BLOCK
}

export function appendSubagentRecursionPrompt(
  basePrompt: string,
  agentName: string,
  recursionConfig: SubagentRecursionConfig | undefined,
): string {
  const block = getSubagentRecursionPrompt(agentName, recursionConfig)
  if (!block) return basePrompt
  return `${basePrompt}\n\n${block}`
}
