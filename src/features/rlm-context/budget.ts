import {
  DEFAULT_RLM_SESSION_MAX_OUTPUT_BYTES,
  DEFAULT_RLM_SESSION_MAX_WALL_TIME_MS,
  DEFAULT_SESSION_BUDGET,
  type RlmConfig,
} from "../../config/schema/experimental"
import type { RlmSessionState } from "./types"

export interface SessionBudget {
  subcall_count: number
  output_bytes: number
  wall_time_ms: number
  wall_time_start_ms: number
  max_subcalls: number
  max_output_bytes: number
  max_wall_time_ms: number
  rootRlmSessionId: string
}

export interface SessionBudgetSummary {
  subcall_count: number
  output_bytes: number
  wall_time_ms: number
}

export function createSessionBudget(
  config: Pick<RlmConfig, "session_budget"> | undefined,
  rootRlmSessionId: string,
  now: number = performance.now(),
): SessionBudget {
  return {
    subcall_count: 0,
    output_bytes: 0,
    wall_time_ms: 0,
    wall_time_start_ms: now,
    max_subcalls: config?.session_budget ?? DEFAULT_SESSION_BUDGET,
    max_output_bytes: DEFAULT_RLM_SESSION_MAX_OUTPUT_BYTES,
    max_wall_time_ms: DEFAULT_RLM_SESSION_MAX_WALL_TIME_MS,
    rootRlmSessionId,
  }
}

export function updateWallTimeMs(budget: SessionBudget, now: number = performance.now()): number {
  budget.wall_time_ms = Math.max(0, Math.round(now - budget.wall_time_start_ms))
  return budget.wall_time_ms
}

export function incrementSubcallCount(budget: SessionBudget, now?: number): number {
  budget.subcall_count += 1
  updateWallTimeMs(budget, now)
  return budget.subcall_count
}

export function addOutputBytes(budget: SessionBudget, bytes: number, now?: number): number {
  budget.output_bytes += Math.max(0, bytes)
  updateWallTimeMs(budget, now)
  return budget.output_bytes
}

export function toSessionBudgetSummary(budget: SessionBudget, now?: number): SessionBudgetSummary {
  return {
    subcall_count: budget.subcall_count,
    output_bytes: budget.output_bytes,
    wall_time_ms: updateWallTimeMs(budget, now),
  }
}

export function shouldReduceDepth(
  budget: SessionBudget,
  _session: Pick<RlmSessionState, "depth" | "maxDepth">,
  now?: number,
): boolean {
  const wallTimeMs = updateWallTimeMs(budget, now)
  const usage = Math.max(
    budget.max_subcalls === 0 ? 0 : budget.subcall_count / budget.max_subcalls,
    budget.max_output_bytes === 0 ? 0 : budget.output_bytes / budget.max_output_bytes,
    budget.max_wall_time_ms === 0 ? 0 : wallTimeMs / budget.max_wall_time_ms,
  )

  return usage >= 0.8
}
