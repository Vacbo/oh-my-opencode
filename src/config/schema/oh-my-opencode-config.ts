import { z } from "zod"
import { AgentDefinitionsConfigSchema } from "./agent-definitions"
import { AgentOverridesSchema } from "./agent-overrides"
import { BabysittingConfigSchema } from "./babysitting"
import { BackgroundTaskConfigSchema } from "./background-task"
import { BrowserAutomationConfigSchema } from "./browser-automation"
import { CategoriesConfigSchema } from "./categories"
import { ClaudeCodeConfigSchema } from "./claude-code"
import { CommentCheckerConfigSchema } from "./comment-checker"
import { ExperimentalConfigSchema } from "./experimental"
import { GitMasterConfigSchema } from "./git-master"
import { NotificationConfigSchema } from "./notification"
import { OpenClawConfigSchema } from "./openclaw"
import { ModelCapabilitiesConfigSchema } from "./model-capabilities"
import { RalphLoopConfigSchema } from "./ralph-loop"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { SkillsConfigSchema } from "./skills"
import { SisyphusConfigSchema } from "./sisyphus"
import { SisyphusAgentConfigSchema } from "./sisyphus-agent"
import { TmuxConfigSchema } from "./tmux"
import { StartWorkConfigSchema } from "./start-work"
import { WebsearchConfigSchema } from "./websearch"

const NonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace-only",
  })

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  /** Paths to external agent definition files (.md or .json) */
  agent_definitions: AgentDefinitionsConfigSchema,
  disabled_mcps: z.array(NonBlankStringSchema).optional(),
  disabled_agents: z.array(NonBlankStringSchema).optional(),
  /**
   * Skills to hide from discovery. Accepts any skill name, not just builtins.
   * Matches against the skill's registered name (e.g. "review-work",
   * "qs-anti-patterns", or user-installed skill names). Unknown names are a
   * silent no-op so stale entries don't break config parsing. Whitespace-only
   * strings are rejected so typos surface during config validation.
   */
  disabled_skills: z.array(NonBlankStringSchema).optional(),
  disabled_hooks: z.array(NonBlankStringSchema).optional(),
  /**
   * Builtin commands to hide from the command picker. Only the OmO builtin
   * commands (e.g. init-deep, ralph-loop, refactor, start-work) pass through
   * this filter; user-defined commands loaded from .opencode/commands/ and
   * skill-sourced commands are always spread on top without consulting this
   * list. Accepts any string for forward compatibility with new builtin
   * commands. Unknown names are a silent no-op. Whitespace-only strings are
   * rejected.
   */
  disabled_commands: z.array(NonBlankStringSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(NonBlankStringSchema).optional(),
  mcp_env_allowlist: z.array(z.string()).optional(),
  /** Enable hashline_edit tool/hook integrations (default: false) */
  hashline_edit: z.boolean().optional(),
  /** Enable model fallback on API errors (default: false). Set to true to enable automatic model switching when model errors occur. */
  model_fallback: z.boolean().optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  /**
   * Enable runtime fallback (default: false)
   * Set to false to disable, or use object for advanced config:
   * { "enabled": true, "retry_on_errors": [400, 429], "timeout_seconds": 30 }
   */
  runtime_fallback: z.union([z.boolean(), RuntimeFallbackConfigSchema]).optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  openclaw: OpenClawConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.default({
    commit_footer: true,
    include_co_authored_by: true,
    git_env_prefix: "GIT_MASTER=1",
  }),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  start_work: StartWorkConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
