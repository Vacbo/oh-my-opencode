import { buildRlmSystemPrompt } from "../../tools/rlm/system-prompt"

const DEFAULT_MAX_DEPTH = 1

export const RLM_ALIAS_PATTERN = /\brlm\b/i

/**
 * Build the keyword-alias message for RLM mode.
 *
 * The keyword alias is a convenience shortcut for short/already-present contexts.
 * It injects the lightweight RLM prompt but does NOT offload context —
 * for paper-faithful long-context handling, use the /rlm command instead.
 */
export function getRlmAliasMessage(): string {
  const prompt = buildRlmSystemPrompt({
    depth: 0,
    maxDepth: DEFAULT_MAX_DEPTH,
    mode: "keyword-alias",
  })

  return `${prompt}

> **Keyword alias active.** This is a convenience shortcut that injects RLM tools
> guidance into the current context. It does NOT offload context out of the model's
> window. For long contexts that exceed the window, use \`/rlm <sources> -- <query>\`
> instead — it offloads context before the first model turn and is paper-faithful.`
}
