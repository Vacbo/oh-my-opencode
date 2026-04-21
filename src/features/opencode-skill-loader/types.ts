import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillMcpConfig } from "../skill-mcp-manager/types"

export type SkillScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project"

export interface SkillMetadata {
  name?: string
  description?: string
  model?: string
  "argument-hint"?: string
  agent?: string
  subtask?: boolean
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  "allowed-tools"?: string | string[]
  mcp?: SkillMcpConfig
  /**
   * Claude Code spec field. When false, the skill is hidden from the
   * slash-command picker. The skill remains callable by agents via the
   * skill tool and via load_skills delegation. Defaults to true per
   * spec (https://docs.claude.com/en/docs/claude-code/skills).
   */
  "user-invocable"?: boolean
  /**
   * Claude Code spec field. When true, the model cannot auto-invoke
   * this skill; it must be called manually by the user. Defaults to
   * false per spec.
   */
  "disable-model-invocation"?: boolean
}

export interface LazyContentLoader {
  loaded: boolean
  content?: string
  load: () => Promise<string>
}

export interface LoadedSkill {
  name: string
  path?: string
  resolvedPath?: string
  definition: CommandDefinition
  scope: SkillScope
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  mcpConfig?: SkillMcpConfig
  lazyContent?: LazyContentLoader
  /**
   * Depth at which this skill was discovered (0 = top-level inside a
   * skills root; 1+ = nested inside another skill's directory). Used by
   * registration filters that honor the OmO skills.hide_nested_by_default
   * inversion flag.
   */
  depth?: number
  /**
   * Raw Claude Code `user-invocable` frontmatter value, if set. Undefined
   * when the frontmatter field is omitted. The effective slash-command
   * visibility (which also factors in the spec default of true and the
   * OmO `skills.hide_nested_by_default` inversion for nested skills) is
   * computed later during command registration, not stored here. Hidden
   * skills remain callable via the skill tool and load_skills
   * delegation; only the slash menu is affected.
   */
  userInvocable?: boolean
  /**
   * Short frontmatter name without the parent-directory prefix. Set
   * for nested skills so registration can present them under a clean
   * flat slash name (/child) instead of the path-prefixed unique name
   * (/parent/child) used internally for deduplication.
   */
  flatName?: string
}
