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
    const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const startAt = deps.now()

    while (deps.now() - startAt < timeoutMs) {
      if (input.abortSignal?.aborted) {
        return { ok: false, error: "Subcall aborted", sessionID }
      }
      await deps.sleep(pollIntervalMs)

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
