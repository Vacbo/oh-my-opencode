import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import { createSessionBudget, updateWallTimeMs } from "../../features/rlm-context/budget"
import { coordinator, type RlmBinding, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { initRlmSession } from "./init-session"
import { parseFinalAnswer } from "./parser"
import { SessionLock } from "./session-lock"
import { cleanupSyncSubcallSession, runSyncSubcall, type SyncSubcallResult } from "./subcall-runner"

export type RlmSubcallModel = { providerID: string; modelID: string; variant?: string }
export type SubRlmOptions = { title?: string }
export interface ExecSubRlmContext {
  sessionID: string
  rlmSessionId: string
  rootQuery: string
  taskPrompt: string
  manager: RlmContextManagerLike
  toolContext: ToolContext
  client: PluginInput["client"]
  directory: string
  subcallAgent?: string
  subcallModel?: RlmSubcallModel
  config: RlmConfig
}

interface SubRlmDeps {
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  initRlmSession: typeof initRlmSession
  now: () => number
  parseFinalAnswer: typeof parseFinalAnswer
  runSyncSubcall: typeof runSyncSubcall
  sessionLock: SessionLock
}

const sharedSessionLock = new SessionLock()

export function createSubRlm(context: ExecSubRlmContext, deps: Partial<SubRlmDeps> = {}) {
  const runtimeDeps: SubRlmDeps = {
    cleanupSyncSubcallSession,
    initRlmSession,
    now: () => performance.now(),
    parseFinalAnswer,
    runSyncSubcall,
    sessionLock: sharedSessionLock,
    ...deps,
  }
  return async (query: string, contextOrVar: string, options?: SubRlmOptions): Promise<string> => {
    const release = await runtimeDeps.sessionLock.acquire(context.rlmSessionId)
    try {
      return await runSubRlm(query, contextOrVar, options, context, runtimeDeps)
    } finally {
      release()
    }
  }
}

async function runSubRlm(query: string, contextOrVar: string, options: SubRlmOptions | undefined, context: ExecSubRlmContext, deps: SubRlmDeps): Promise<string> {
  const binding = coordinator.resolve(context.sessionID)
  if (!binding) throw new Error(`RLM binding not found: ${context.sessionID}`)
  const session = await context.manager.getSession(context.rlmSessionId)
  if (!session) throw new Error(`Session not found: ${context.rlmSessionId}`)
  coordinator.initializeRootBudget(context.sessionID, createSessionBudget(context.config, binding.rootRlmSessionId ?? binding.rlmSessionId, deps.now()))
  const budget = coordinator.getRootBudget(context.sessionID)
  if (budget) {
    updateWallTimeMs(budget, deps.now())
    if (budget.subcall_count >= context.config.subcall_limit) throw new Error(`sub_rlm exceeded subcall_limit (${context.config.subcall_limit})`)
  }
  const childContext = await resolveContextInput(context.manager, context.rlmSessionId, contextOrVar)
  const timeoutMs = budget ? Math.max(1, Math.min(context.config.subcall_timeout_ms, budget.max_wall_time_ms - budget.wall_time_ms)) : context.config.subcall_timeout_ms
  coordinator.incrementSubcallCount(context.sessionID)
  return session.depth + 1 >= session.maxDepth
    ? executeLeafSubcall(query, childContext, options, context, timeoutMs, deps)
    : executeRecursiveSubcall(query, childContext, options, context, binding, session, timeoutMs, deps)
}

async function executeLeafSubcall(query: string, childContext: string, options: SubRlmOptions | undefined, context: ExecSubRlmContext, timeoutMs: number, deps: SubRlmDeps): Promise<string> {
  const subcall = await deps.runSyncSubcall({
    client: context.client,
    parentSessionID: context.sessionID,
    defaultDirectory: context.directory,
    title: options?.title ?? "RLM sub_rlm",
    prompt: `${query}\n\nContext:\n${childContext}`,
    agent: context.subcallAgent ?? context.toolContext.agent,
    model: context.subcallModel,
    tools: { rlm_finish: false, rlm_plan: false, rlm_probe: false, rlm_search: false },
    abortSignal: context.toolContext.abort,
    timeoutMs,
    pollIntervalMs: context.config.subcall_poll_interval_ms,
    backoffMultiplier: context.config.subcall_backoff_multiplier,
    jitterPercent: context.config.subcall_jitter_percent,
    maxIntervalMs: context.config.subcall_max_interval_ms,
  })
  try {
    if (!subcall.ok) throw new Error(subcall.error)
    const output = subcall.terminalPayload?.final_answer ?? subcall.textOutput
    coordinator.addOutputBytes(context.sessionID, Buffer.byteLength(output, "utf8"))
    return output
  } finally {
    if (subcall.sessionID) deps.cleanupSyncSubcallSession(subcall.sessionID)
  }
}

async function executeRecursiveSubcall(
  query: string,
  childContext: string,
  options: SubRlmOptions | undefined,
  context: ExecSubRlmContext,
  binding: RlmBinding,
  session: NonNullable<Awaited<ReturnType<RlmContextManagerLike["getSession"]>>>,
  timeoutMs: number,
  deps: SubRlmDeps,
): Promise<string> {
  const tracer = binding.tracer
  const span = tracer?.startSpan(context.sessionID, context.rlmSessionId, "exec.sub_rlm", undefined, { operation_name: "sub_rlm", operation_args: { title: options?.title ?? "RLM sub_rlm" } })
  let subcall: SyncSubcallResult | undefined
  try {
    subcall = await deps.runSyncSubcall({
      client: context.client,
      parentSessionID: context.sessionID,
      defaultDirectory: context.directory,
      title: options?.title ?? "RLM sub_rlm",
      prompt: query,
      agent: context.subcallAgent ?? context.toolContext.agent,
      model: context.subcallModel,
      abortSignal: context.toolContext.abort,
      timeoutMs,
      pollIntervalMs: context.config.subcall_poll_interval_ms,
      backoffMultiplier: context.config.subcall_backoff_multiplier,
      jitterPercent: context.config.subcall_jitter_percent,
      maxIntervalMs: context.config.subcall_max_interval_ms,
      onSessionCreated: async (childSessionID) => {
        const child = await deps.initRlmSession(context.manager, {
          sessionId: childSessionID,
          query,
          content: childContext,
          depth: session.depth + 1,
          parentSessionId: session.sessionId,
          maxDepth: session.maxDepth,
          contextDir: session.contextDir,
          shouldDistill: session.shouldDistill,
        })
        coordinator.bind(childSessionID, {
          manager: binding.manager,
          rlmSessionId: childSessionID,
          rootRlmSessionId: binding.rootRlmSessionId,
          depth: child.depth,
          rootQuery: child.rootQuery,
          taskPrompt: child.taskPrompt,
          contextVariableName: child.contextMetadata.contextVariableName,
          trusted: binding.trusted,
          budget: binding.budget,
          tracer,
        })
      },
    })
    if (!subcall.ok) throw new Error(subcall.error)
    if (!subcall.sessionID) throw new Error("Recursive child session was not created")
    const output = await resolveRecursiveOutput(context.manager, subcall.sessionID, subcall, deps)
    coordinator.addOutputBytes(context.sessionID, Buffer.byteLength(output, "utf8"))
    tracer?.endSpan(span!.spanId, "ok")
    return output
  } catch (error) {
    tracer?.endSpan(span!.spanId, "error", error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (subcall?.sessionID) {
      coordinator.unbind(subcall.sessionID)
      await context.manager.deleteSession(subcall.sessionID)
      deps.cleanupSyncSubcallSession(subcall.sessionID)
    }
  }
}

async function resolveContextInput(manager: RlmContextManagerLike, sessionID: string, contextOrVar: string): Promise<string> {
  const variable = await manager.getVariableByName(sessionID, contextOrVar)
  if (!variable) return contextOrVar
  if (variable.storageKind !== "blob") throw new Error(`Blob variable not found: ${contextOrVar}`)
  return manager.readBlobContent(variable)
}

async function resolveRecursiveOutput(manager: RlmContextManagerLike, childSessionID: string, subcall: Extract<SyncSubcallResult, { ok: true }>, deps: SubRlmDeps): Promise<string> {
  if (subcall.terminalPayload?.final_answer) return subcall.terminalPayload.final_answer
  const parsed = deps.parseFinalAnswer(subcall.textOutput)
  if (parsed?.type === "final") return parsed.content
  if (parsed?.type !== "final_var") throw new Error("Recursive child did not return rlm_finish, FINAL(), or FINAL_VAR()")
  const variable = await manager.getVariableByName(childSessionID, parsed.variableName)
  if (!variable || variable.storageKind !== "blob") throw new Error(`variable not found: ${parsed.variableName}`)
  return manager.readBlobContent(variable)
}
