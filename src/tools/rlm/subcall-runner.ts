import type { PluginInput } from "@opencode-ai/plugin"
import {
  normalizeSDKResponse,
  promptSyncWithModelSuggestionRetry,
} from "../../shared"
import {
  clearSessionAgent,
  setSessionAgent,
  subagentSessions,
  syncSubagentSessions,
} from "../../features/claude-code-session-state"
import {
  extractAssistantText,
  extractTerminalPayload,
  isSubcallComplete,
  type TerminalPayload,
} from "./subcall-message-utils"

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 400
const DEFAULT_BACKOFF_MULTIPLIER = 1.5
const DEFAULT_JITTER_PERCENT = 15
const DEFAULT_MAX_INTERVAL_MS = 5000

export interface BackoffConfig {
  initial_interval_ms: number
  backoff_multiplier: number
  jitter_percent: number
  max_interval_ms: number
}

/**
 * Pure function to calculate the next polling interval using exponential backoff with jitter.
 * @param current - The current interval in milliseconds (0 for first poll)
 * @param config - Backoff configuration
 * @returns The next interval in milliseconds, capped at max_interval_ms
 */
export function calculateNextInterval(current: number, config: BackoffConfig): number {
  // On first call (current=0), return initial_interval_ms
  if (current === 0) {
    return config.initial_interval_ms
  }

  // Calculate exponential backoff
  let next = current * config.backoff_multiplier

  // Apply jitter: random value between -jitter_percent and +jitter_percent
  const jitterFactor = config.jitter_percent * (Math.random() - 0.5) * 2 // Range: -jitter% to +jitter%
  next = next * (1 + jitterFactor / 100)

  // Cap at max_interval_ms
  return Math.min(Math.round(next), config.max_interval_ms)
}

type SessionStatus = { type?: string }
type SessionMessage = {
  info?: { role?: string; finish?: string; time?: { created?: number } }
  parts?: unknown[]
}

export interface SyncSubcallInput {
  client: PluginInput["client"]
  parentSessionID: string
  defaultDirectory: string
  title: string
  prompt: string
  agent: string
  tools?: Record<string, boolean>
  model?: { providerID: string; modelID: string; variant?: string }
  abortSignal?: AbortSignal
  timeoutMs?: number
  pollIntervalMs?: number
  backoffMultiplier?: number
  jitterPercent?: number
  maxIntervalMs?: number
  onSessionCreated?: (sessionID: string) => Promise<void> | void
}

export type SyncSubcallResult =
  | {
      ok: true
      sessionID: string
      textOutput: string
      terminalPayload?: TerminalPayload
      messages: SessionMessage[]
    }
  | {
      ok: false
      error: string
      sessionID?: string
    }

export interface SyncSubcallDeps {
  now: () => number
  sleep: (ms: number) => Promise<void>
  promptSync: typeof promptSyncWithModelSuggestionRetry
}

const defaultDeps: SyncSubcallDeps = {
  now: Date.now,
  sleep: async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  },
  promptSync: promptSyncWithModelSuggestionRetry,
}

async function loadMessages(client: PluginInput["client"], sessionID: string): Promise<SessionMessage[]> {
  const response = await client.session.messages({ path: { id: sessionID } })
  return normalizeSDKResponse(response, [] as SessionMessage[], {
    preferResponseOnMissingData: true,
  })
}

export async function runSyncSubcall(
  input: SyncSubcallInput,
  deps: SyncSubcallDeps = defaultDeps,
): Promise<SyncSubcallResult> {
  let sessionID: string | undefined
  try {
    const parent = input.client.session.get
      ? await input.client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
      : null
    const directory = parent?.data?.directory ?? input.defaultDirectory

    const created = await input.client.session.create({
      body: { parentID: input.parentSessionID, title: input.title } as Record<string, unknown>,
      query: { directory },
    })
    if (created.error) {
      return { ok: false, error: `Failed to create session: ${created.error}` }
    }

    sessionID = created.data.id
    subagentSessions.add(sessionID)
    syncSubagentSessions.add(sessionID)
    setSessionAgent(sessionID, input.agent)

    if (input.onSessionCreated) {
      await input.onSessionCreated(sessionID)
    }

    await deps.promptSync(input.client, {
      path: { id: sessionID },
      body: {
        agent: input.agent,
        tools: input.tools,
        parts: [{ type: "text", text: input.prompt }],
        ...(input.model
          ? { model: { providerID: input.model.providerID, modelID: input.model.modelID } }
          : {}),
        ...(input.model?.variant ? { variant: input.model.variant } : {}),
      },
    })

    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const initialIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const backoffConfig: BackoffConfig = {
      initial_interval_ms: initialIntervalMs,
      backoff_multiplier: input.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
      jitter_percent: input.jitterPercent ?? DEFAULT_JITTER_PERCENT,
      max_interval_ms: input.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS,
    }
    const startAt = deps.now()
    let currentInterval = 0

    while (deps.now() - startAt < timeoutMs) {
      if (input.abortSignal?.aborted) {
        return { ok: false, error: "Subcall aborted", sessionID }
      }
      currentInterval = calculateNextInterval(currentInterval, backoffConfig)
      await deps.sleep(currentInterval)

      const statusResponse = await input.client.session.status().catch(() => null)
      const statuses = normalizeSDKResponse(statusResponse, {} as Record<string, SessionStatus>)
      const status = statuses[sessionID]
      if (status?.type && status.type !== "idle") {
        continue
      }

      const messages = await loadMessages(input.client, sessionID)
      if (isSubcallComplete(messages)) {
        return {
          ok: true,
          sessionID,
          textOutput: extractAssistantText(messages),
          terminalPayload: extractTerminalPayload(messages),
          messages,
        }
      }
    }

    return { ok: false, error: `Subcall timeout after ${timeoutMs}ms`, sessionID }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      sessionID,
    }
  }
}

export function cleanupSyncSubcallSession(sessionID: string): void {
  subagentSessions.delete(sessionID)
  syncSubagentSessions.delete(sessionID)
  clearSessionAgent(sessionID)
}
