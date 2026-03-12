import { shouldReduceDepth } from "../../features/rlm-context/budget"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { log } from "../../shared/logger"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import { itemVariableName, requireBlob } from "./plan-utils"
import { SessionLock } from "./session-lock"
import type { SyncSubcallResult } from "./subcall-runner"

export type StagedResult = { index: number; content: string }
type MapFailure = { index: number; message: string }

const sessionLock = new SessionLock()

export function logDynamicDepthAdvisory(chatSessionId: string, session: RlmSessionState): void {
  const budget = coordinator.getRootBudget(chatSessionId)
  if (!budget || !shouldReduceDepth(budget, session)) {
    return
  }

  log("[rlm-plan] dynamic depth budget advisory", {
    sessionID: chatSessionId,
    rlmSessionId: session.sessionId,
    rootRlmSessionId: budget.rootRlmSessionId,
    depth: session.depth,
    maxDepth: session.maxDepth,
    subcall_count: budget.subcall_count,
    max_subcalls: budget.max_subcalls,
    output_bytes: budget.output_bytes,
    max_output_bytes: budget.max_output_bytes,
    wall_time_ms: budget.wall_time_ms,
    max_wall_time_ms: budget.max_wall_time_ms,
  })
}

export async function resolveRecursiveOutput(
  contextManager: RlmContextManagerLike,
  childSessionID: string,
  subcallResult: SyncSubcallResult,
  deps: RlmPlanExecutorDeps,
): Promise<string> {
  if (!subcallResult.ok) {
    throw new Error(subcallResult.error)
  }
  if (subcallResult.terminalPayload?.final_answer) {
    return subcallResult.terminalPayload.final_answer
  }
  const parsed = deps.parseFinalAnswer(subcallResult.textOutput)
  if (parsed?.type === "final") {
    return parsed.content
  }
  if (parsed?.type === "final_var") {
    const variable = await requireBlob(contextManager, childSessionID, parsed.variableName)
    return contextManager.readBlobContent(variable)
  }
  throw new Error("Recursive child did not return rlm_finish, FINAL(), or FINAL_VAR()")
}

export function throwAggregateMapError(op: "map_llm" | "map_rlm", failures: MapFailure[]): never {
  const details = failures.map((failure) => `item ${failure.index + 1}: ${failure.message}`).join("; ")
  throw new Error(`${op} failed for ${failures.length} item(s): ${details}`)
}

export async function persistOutputs(
  contextManager: RlmContextManagerLike,
  rlmSessionId: string,
  outputVariable: string,
  staged: StagedResult[],
): Promise<void> {
  const release = await sessionLock.acquire(rlmSessionId)
  try {
    const outputNames: string[] = []
    for (const result of staged.sort((left, right) => left.index - right.index)) {
      const outputName = itemVariableName(outputVariable, result.index)
      await contextManager.createBlobVariable(
        rlmSessionId,
        { name: outputName, content: result.content },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
    }
    await contextManager.createManifestVariable(
      rlmSessionId,
      { name: outputVariable, variableNames: outputNames },
      { semanticType: "result" },
    )
  } finally {
    release()
  }
}

export async function runParallelMap<TItem>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<StagedResult>,
): Promise<{ staged: StagedResult[]; failures: MapFailure[] }> {
  const staged: StagedResult[] = []
  const failures: MapFailure[] = []

  for (let chunkStart = 0; chunkStart < items.length; chunkStart += concurrency) {
    const chunk = items.slice(chunkStart, chunkStart + concurrency)
    const settled = await Promise.allSettled(chunk.map((item, offset) => worker(item, chunkStart + offset)))
    for (let offset = 0; offset < settled.length; offset += 1) {
      const result = settled[offset]
      if (result.status === "fulfilled") {
        staged.push(result.value)
        continue
      }
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      failures.push({ index: chunkStart + offset, message: reason })
    }
  }

  return { staged, failures }
}
