import { z } from "zod"
import { DynamicContextPruningConfigSchema } from "./dynamic-context-pruning"

export const DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES = 2048
export const DEFAULT_RLM_EXEC_TIMEOUT_MS = 30000

export const DEFAULT_PROBE_VIEW_LINES = 50
export const DEFAULT_PROBE_LIST_PREVIEW_LINES = 3
export const DEFAULT_PROBE_MAX_REF_PREVIEW_CHARS = 200

export const DEFAULT_SUBCALL_TIMEOUT_MS = 60_000
export const DEFAULT_SUBCALL_POLL_INTERVAL_MS = 400
export const DEFAULT_SUBCALL_BACKOFF_MULTIPLIER = 1.5
export const DEFAULT_SUBCALL_JITTER_PERCENT = 15
export const DEFAULT_SUBCALL_MAX_INTERVAL_MS = 5000

export const DEFAULT_SEARCH_DEFAULT_MAX_RESULTS = 20
export const DEFAULT_SEARCH_MAX_RESULTS = 100

export const DEFAULT_PLAN_MAX_OPERATIONS = 50
export const DEFAULT_PARALLEL_MAP_CONCURRENCY = 3
export const DEFAULT_CONTEXT_ROT_CHECK_INTERVAL = 5
export const DEFAULT_CONTEXT_ROT_WARNING_THRESHOLD = 0.7
export const DEFAULT_SIBLING_CACHE_TTL_HOURS = 24

export const DEFAULT_SESSION_BUDGET = 20
export const DEFAULT_RLM_SESSION_MAX_OUTPUT_BYTES = 10_000_000
export const DEFAULT_RLM_SESSION_MAX_WALL_TIME_MS = 600_000
export const DEFAULT_SUBCALL_LIMIT = 10

const RlmFeedbackConfigSchema = z.object({
  output_threshold_bytes: z.number().int().min(1).default(DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES),
})

const RlmExecConfigSchema = z.object({
  trusted_only: z.boolean().default(true),
  timeout_ms: z.number().int().min(1000).default(DEFAULT_RLM_EXEC_TIMEOUT_MS),
  print_limit_bytes: z.number().int().min(1).default(DEFAULT_RLM_OUTPUT_THRESHOLD_BYTES),
})

const RlmParallelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_concurrent: z.number().int().min(1).default(4),
})

const RlmPersistenceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_sessions: z.number().int().min(1).default(100),
})

const RlmTracingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  output: z.enum(["log", "file", "both"]).default("log"),
  spans_dir: z.string().default(".sisyphus/rlm-traces"),
  distill_enabled: z.boolean().default(false),
})

const RlmProgressConfigSchema = z.object({
  enabled: z.boolean().default(true),
  throttle_ms: z.number().int().min(100).default(200),
  streaming_enabled: z.boolean().default(true),
  streaming_throttle_ms: z.number().int().min(0).default(100),
})

const RlmContextRotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  check_interval: z.number().int().min(1).default(DEFAULT_CONTEXT_ROT_CHECK_INTERVAL),
  warning_threshold: z.number().min(0).max(1).default(DEFAULT_CONTEXT_ROT_WARNING_THRESHOLD),
})

const RlmCacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl_hours: z.number().int().min(1).default(DEFAULT_SIBLING_CACHE_TTL_HOURS),
})

export type RlmTracingConfig = z.infer<typeof RlmTracingConfigSchema>
export type RlmProgressConfig = z.infer<typeof RlmProgressConfigSchema>
export type RlmContextRotConfig = z.infer<typeof RlmContextRotConfigSchema>

export const RlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_depth: z.number().int().min(1).max(5).default(1),
  context_storage_dir: z.string().default(".sisyphus/rlm-contexts"),
  distill_threshold_tokens: z.number().int().min(100).default(2000),
  feedback: RlmFeedbackConfigSchema.optional(),
  exec: RlmExecConfigSchema.optional(),
  subcall_model: z.string().optional(),
  probe_max_lines: z.number().int().min(10).default(200),
  probe_view_lines: z.number().int().min(1).default(DEFAULT_PROBE_VIEW_LINES),
  probe_list_preview_lines: z.number().int().min(1).default(DEFAULT_PROBE_LIST_PREVIEW_LINES),
  probe_max_ref_preview_chars: z.number().int().min(1).default(DEFAULT_PROBE_MAX_REF_PREVIEW_CHARS),
  subcall_timeout_ms: z.number().int().min(1000).default(DEFAULT_SUBCALL_TIMEOUT_MS),
  subcall_poll_interval_ms: z.number().int().min(100).default(DEFAULT_SUBCALL_POLL_INTERVAL_MS),
  subcall_backoff_multiplier: z.number().min(1.0).default(DEFAULT_SUBCALL_BACKOFF_MULTIPLIER),
  subcall_jitter_percent: z.number().min(0).max(100).default(DEFAULT_SUBCALL_JITTER_PERCENT),
  subcall_max_interval_ms: z.number().int().min(100).default(DEFAULT_SUBCALL_MAX_INTERVAL_MS),
  search_default_max_results: z.number().int().min(1).default(DEFAULT_SEARCH_DEFAULT_MAX_RESULTS),
  search_max_results: z.number().int().min(1).default(DEFAULT_SEARCH_MAX_RESULTS),
  plan_max_operations: z.number().int().min(1).default(DEFAULT_PLAN_MAX_OPERATIONS),
  parallel_map_concurrency: z.number().int().min(1).default(DEFAULT_PARALLEL_MAP_CONCURRENCY),
  session_budget: z.number().int().min(1).default(DEFAULT_SESSION_BUDGET),
  subcall_limit: z.number().int().min(1).default(DEFAULT_SUBCALL_LIMIT),
  parallel: RlmParallelConfigSchema.optional(),
  persistence: RlmPersistenceConfigSchema.optional(),
  tracing: RlmTracingConfigSchema.optional(),
  progress: RlmProgressConfigSchema.optional(),
  cache: RlmCacheConfigSchema.default({ enabled: true, ttl_hours: DEFAULT_SIBLING_CACHE_TTL_HOURS }),
  context_rot: RlmContextRotConfigSchema.optional(),
  benchmark_datasets_dir: z.string().default(".sisyphus/rlm-benchmarks"),
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

type RlmExecFeedbackConfig = {
  exec?: RlmConfig["exec"]
  feedback?: RlmConfig["feedback"]
}

export function warnConfigInconsistencies(config: RlmExecFeedbackConfig): void {
  const exec = config.exec
  const feedback = config.feedback

  if (!exec || !feedback) {
    return
  }

  if (exec.print_limit_bytes > feedback.output_threshold_bytes) {
    process.stderr.write(
      `[OhMyOpenCode] Warning: rlm.exec.print_limit_bytes (${exec.print_limit_bytes}) ` +
        `is greater than rlm.feedback.output_threshold_bytes (${feedback.output_threshold_bytes}). ` +
        `This may cause unexpected behavior in exec output handling.\n`,
    )
  }
}
