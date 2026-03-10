import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmSessionState } from "../../features/rlm-context/types"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import { fillTemplate, itemVariableName, resolveSubcallText } from "./plan-utils"

interface StagedResult {
  index: number
  content: string
  sessionID?: string
}

export async function executeParallelMapLlm(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number }> {
  const maxConcurrent = options.config?.parallel?.max_concurrent ?? 4
  const items = await contextManager.resolveManifestItems(context.sessionID, input.variable_name)

  const staged: StagedResult[] = []
  const allSessionIDs: string[] = []

  for (let chunkStart = 0; chunkStart < items.length; chunkStart += maxConcurrent) {
    const chunkEnd = Math.min(chunkStart + maxConcurrent, items.length)
    const chunk = items.slice(chunkStart, chunkEnd)

    const chunkPromises = chunk.map(async (item, chunkIndex) => {
      const index = chunkStart + chunkIndex
      const itemContent = await contextManager.readBlobContent(item)
      const subcall = await deps.runSyncSubcall({
        client: options.client,
        parentSessionID: context.sessionID,
        defaultDirectory: options.directory,
        title: `RLM map_llm ${index + 1}/${items.length}`,
        prompt: fillTemplate(input.prompt, session.query, itemContent),
        agent: options.subcallAgent ?? context.agent,
        model: options.subcallModel,
        abortSignal: context.abort,
      })

      if (subcall.sessionID) {
        allSessionIDs.push(subcall.sessionID)
      }

      return {
        index,
        content: resolveSubcallText(subcall),
        sessionID: subcall.sessionID,
      }
    })

    const chunkResults = await Promise.allSettled(chunkPromises)
    const failures: string[] = []

    for (const result of chunkResults) {
      if (result.status === "rejected") {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
        failures.push(reason)
      } else {
        staged.push(result.value)
      }
    }

    if (failures.length > 0) {
      for (const sid of allSessionIDs) {
        deps.cleanupSyncSubcallSession(sid)
      }
      throw new Error(`Parallel map_llm failed: ${failures.join("; ")}`)
    }
  }

  staged.sort((a, b) => a.index - b.index)

  try {
    const outputNames: string[] = []
    for (const result of staged) {
      const outputName = itemVariableName(input.output_variable, result.index)
      await contextManager.createBlobVariable(
        context.sessionID,
        { name: outputName, content: result.content },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
    }

    await contextManager.createManifestVariable(
      context.sessionID,
      { name: input.output_variable, variableNames: outputNames },
      { semanticType: "result" },
    )

    return { output_variable: input.output_variable, mapped_count: outputNames.length }
  } finally {
    for (const sid of allSessionIDs) {
      deps.cleanupSyncSubcallSession(sid)
    }
  }
}
