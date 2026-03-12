import type { RlmConfig } from "../../config/schema/experimental"
import {
  formatPrintedValue,
  readBlobContent,
  toStoredContent,
  upsertBlobVariable,
} from "./repl-variable-bridge"
import { createSubRlm, type ExecSubRlmContext } from "./sub-rlm"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"

type RlmLlmQueryOptions = { title?: string }

interface ExecNamespaceDeps {
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  runSyncSubcall: typeof runSyncSubcall
}

export const helperNames = new Set([
  "getQuery",
  "getRootQuery",
  "getVar",
  "setVar",
  "llm_query",
  "sub_rlm",
  "print",
])

export function installExecNamespace(
  namespace: Record<string, unknown>,
  context: ExecSubRlmContext,
  config: Pick<RlmConfig, "subcall_timeout_ms" | "subcall_poll_interval_ms">,
  appendPrinted: (chunk: string) => void,
  deps: Partial<ExecNamespaceDeps> = {},
): void {
  const runtimeDeps: ExecNamespaceDeps = {
    cleanupSyncSubcallSession,
    runSyncSubcall,
    ...deps,
  }

  namespace.getQuery = (): string => context.taskPrompt
  namespace.getRootQuery = (): string => context.rootQuery
  namespace.getVar = async (name: string): Promise<string> =>
    readBlobContent(context.manager, context.rlmSessionId, name)
  namespace.setVar = async (name: string, value: unknown): Promise<void> => {
    await upsertBlobVariable(
      context.manager,
      context.rlmSessionId,
      name,
      toStoredContent(value),
    )
    namespace[name] = value
  }
  namespace.llm_query = async (
    prompt: string,
    options?: RlmLlmQueryOptions,
  ): Promise<string> => {
    const subcall = await runtimeDeps.runSyncSubcall({
      client: context.client,
      parentSessionID: context.sessionID,
      defaultDirectory: context.directory,
      title: options?.title ?? "RLM llm_query",
      prompt,
      agent: context.subcallAgent ?? context.toolContext.agent,
      model: context.subcallModel,
      tools: { rlm_finish: false, rlm_plan: false, rlm_probe: false, rlm_search: false },
      abortSignal: context.toolContext.abort,
      timeoutMs: config.subcall_timeout_ms,
      pollIntervalMs: config.subcall_poll_interval_ms,
    })
    try {
      if (!subcall.ok) throw new Error(subcall.error)
      return subcall.terminalPayload?.final_answer ?? subcall.textOutput
    } finally {
      if (subcall.sessionID) runtimeDeps.cleanupSyncSubcallSession(subcall.sessionID)
    }
  }
  namespace.sub_rlm = createSubRlm(context, runtimeDeps)
  namespace.print = (value: unknown): void => {
    appendPrinted(`${formatPrintedValue(value)}\n`)
  }
}

export type { ExecSubRlmContext }
