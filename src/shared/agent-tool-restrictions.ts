import { stripInvisibleAgentCharacters } from "./agent-display-names"
import type { SubagentRecursionConfig } from "../config/schema/experimental"

/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

const DEFAULT_RECURSION_ALLOWED_AGENTS = new Set(["explore", "librarian"])

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },

  metis: {
    write: false,
    edit: false,
    task: false,
  },

  momus: {
    write: false,
    edit: false,
    task: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  // Custom/unknown agents get no restrictions (empty object), matching Claude Code's
  // trust model where project-registered agents retain full tool access including bash.
  const stripped = stripInvisibleAgentCharacters(agentName)
  return AGENT_RESTRICTIONS[stripped]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1]
    ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = getAgentToolRestrictions(agentName)
  return Object.keys(restrictions).length > 0
}

function normalizeAgentName(name: string): string {
  return stripInvisibleAgentCharacters(name).trim().toLowerCase()
}

export function isSubagentRecursionAllowed(
  agentName: string,
  recursionConfig: SubagentRecursionConfig | undefined,
): boolean {
  if (!recursionConfig?.enabled) return false

  const allowedAgents = recursionConfig.allowed_agents ?? Array.from(DEFAULT_RECURSION_ALLOWED_AGENTS)
  const normalized = normalizeAgentName(agentName)
  return allowedAgents.some((allowed) => normalizeAgentName(allowed) === normalized)
}

export function getAgentToolRestrictionsForSpawn(
  agentName: string,
  recursionConfig: SubagentRecursionConfig | undefined,
): Record<string, boolean> {
  const baseRestrictions = getAgentToolRestrictions(agentName)
  if (!isSubagentRecursionAllowed(agentName, recursionConfig)) {
    return baseRestrictions
  }
  // Omit call_omo_agent so the caller's default (set to true at spawn
  // sites before spreading restrictions) wins. task stays blocked
  // because it bypasses the OmO budget system.
  const { call_omo_agent: _dropped, ...rest } = baseRestrictions
  return rest
}
