import { z } from "zod"
import { DynamicContextPruningConfigSchema } from "./dynamic-context-pruning"

export const DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES = 2048
export const DEFAULT_RLM_EXEC_TIMEOUT_MS = 30000

const RlmFeedbackConfigSchema = z.object({
  output_threshold_bytes: z.number().int().min(1).default(2048),
})

const RlmExecConfigSchema = z.object({
  trusted_only: z.boolean().default(true),
  timeout_ms: z.number().int().min(1000).default(30000),
  print_limit_bytes: z.number().int().min(1).default(2048),
})

export const RlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_depth: z.number().int().min(1).max(5).default(1),
  context_storage_dir: z.string().default(".sisyphus/rlm-contexts"),
  distill_threshold_tokens: z.number().int().min(100).default(2000),
  feedback: RlmFeedbackConfigSchema.optional(),
  exec: RlmExecConfigSchema.optional(),
  subcall_model: z.string().optional(),
  probe_max_lines: z.number().int().min(10).default(200),
})

export type RlmConfig = z.infer<typeof RlmConfigSchema>

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  preemptive_compaction: z.boolean().optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
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
  /** RLM (Recursive Language Model) configuration */
  rlm: RlmConfigSchema.optional(),
})

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
