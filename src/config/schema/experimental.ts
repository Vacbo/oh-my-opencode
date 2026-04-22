import { z } from "zod"
import { DynamicContextPruningConfigSchema } from "./dynamic-context-pruning"

export const SubagentRecursionConfigSchema = z.object({
  /**
   * Gate for the entire feature. When false or absent, subagent recursion
   * is blocked exactly as before - no behavior change from the default.
   */
  enabled: z.boolean().optional(),
  /**
   * Agents allowed to spawn subagents when `enabled` is true. Only names
   * listed here get `call_omo_agent: false` removed from their denylist.
   * Defaults to `["explore", "librarian"]` when omitted. Oracle is NOT
   * in the default list because Oracle is meant to be a leaf consultant.
   */
  allowed_agents: z.array(z.string()).optional(),
})

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  preemptive_compaction: z.boolean().optional(),
  truncate_all_tool_outputs: z.boolean().optional(),
  /** Dynamic context pruning configuration */
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
  /** Enable experimental task system for Todowrite disabler hook */
  task_system: z.boolean().optional(),
  /** Timeout in ms for loadAllPluginComponents during config handler init (default: 10000, min: 1000) */
  plugin_load_timeout_ms: z.number().min(1000).optional(),
  /** Wrap hook creation in try/catch to prevent one failing hook from crashing the plugin (default: true at call site) */
  safe_hook_creation: z.boolean().optional(),
  /** Disable auto-injected <omo-env> context in prompts (experimental) */
  disable_omo_env: z.boolean().optional(),
  /** Enable hashline_edit tool for improved file editing with hash-based line anchors */
  hashline_edit: z.boolean().optional(),
  /** Append fallback model info to session title when a runtime fallback occurs (default: false) */
  model_fallback_title: z.boolean().optional(),
  /** Maximum number of tools to register. When set, lower-priority tools are excluded to stay within provider limits (e.g., OpenAI's 128-tool cap). Accounts for ~20 OpenCode built-in tools. */
  max_tools: z.number().int().min(1).optional(),
  /**
   * Opt-in subagent recursion. When enabled, listed agents can use
   * `call_omo_agent` to spawn further subagents, capped by the existing
   * `background_task.maxDepth` (default 3) and `background_task.maxDescendants`
   * (default 50) guardrails. The `task` tool remains blocked for subagents
   * even when this flag is on, because `task` bypasses the OmO budget system.
   */
  subagent_recursion: SubagentRecursionConfigSchema.optional(),
})

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type SubagentRecursionConfig = z.infer<typeof SubagentRecursionConfigSchema>
