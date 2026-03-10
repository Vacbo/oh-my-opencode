import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmSessionState } from "../../features/rlm-context/types"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import type { SyncSubcallResult } from "./subcall-runner"
import { fillTemplate, itemVariableName, requireBlob, resolveSubcallText } from "./plan-utils"
import { coordinator } from "../../features/rlm-context/coordinator"

async function resolveRecursiveOutput(
  contextManager: RlmContextManagerForPlan,
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

export async function executeMapLlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number }> {
  const items = await contextManager.resolveManifestItems(context.sessionID, input.variable_name)
  const outputNames: string[] = []
  for (let index = 0; index < items.length; index += 1) {
    const itemContent = await contextManager.readBlobContent(items[index])
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
    try {
      const outputName = itemVariableName(input.output_variable, index)
      await contextManager.createBlobVariable(
        context.sessionID,
        { name: outputName, content: resolveSubcallText(subcall) },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
    } finally {
      if (subcall.sessionID) {
        deps.cleanupSyncSubcallSession(subcall.sessionID)
      }
    }
  }
  await contextManager.createManifestVariable(
    context.sessionID,
    { name: input.output_variable, variableNames: outputNames },
    { semanticType: "result" },
  )

  return { output_variable: input.output_variable, mapped_count: outputNames.length }
}

export async function executeMapRlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number; downgraded_to?: string }> {
  if (session.depth + 1 >= session.maxDepth) {
    const downgraded = await executeMapLlmOperation(contextManager, options, context, session, input, deps)
    return { ...downgraded, downgraded_to: "map_llm" }
  }
  const items = await contextManager.resolveManifestItems(context.sessionID, input.variable_name)
  const outputNames: string[] = []
  for (let index = 0; index < items.length; index += 1) {
    const itemContent = await contextManager.readBlobContent(items[index])
    const subcall = await deps.runSyncSubcall({
      client: options.client,
      parentSessionID: context.sessionID,
      defaultDirectory: options.directory,
      title: `RLM map_rlm ${index + 1}/${items.length}`,
      prompt: fillTemplate(input.prompt, session.query, itemContent),
      agent: options.subcallAgent ?? context.agent,
      model: options.subcallModel,
      abortSignal: context.abort,
      onSessionCreated: async (childSessionID) => {
        await deps.initRlmSession(contextManager, {
          sessionId: childSessionID,
          query: session.query,
          content: itemContent,
          depth: session.depth + 1,
          parentSessionId: session.sessionId,
          maxDepth: session.maxDepth,
          contextDir: session.contextDir,
          shouldDistill: session.shouldDistill,
        })
        // Bind child session through coordinator with inherited trust.
        // Resolve parent binding to get the full RlmContextManager instance.
        const parentBinding = coordinator.resolve(context.sessionID)
        if (parentBinding) {
          coordinator.bind(childSessionID, {
            manager: parentBinding.manager,
            rlmSessionId: childSessionID,
            depth: session.depth + 1,
            query: session.query,
            contextVariableName: "item",
            trusted: true,
          })
        }
      },
    })
    try {
      if (!subcall.sessionID) {
        throw new Error("Recursive child session was not created")
      }
      const outputName = itemVariableName(input.output_variable, index)
      await contextManager.createBlobVariable(
        context.sessionID,
        {
          name: outputName,
          content: await resolveRecursiveOutput(contextManager, subcall.sessionID, subcall, deps),
        },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
    } finally {
      if (subcall.sessionID) {
        coordinator.unbind(subcall.sessionID)
        await contextManager.deleteSession(subcall.sessionID)
        deps.cleanupSyncSubcallSession(subcall.sessionID)
      }
    }
  }
  await contextManager.createManifestVariable(
    context.sessionID,
    { name: input.output_variable, variableNames: outputNames },
    { semanticType: "result" },
  )

  return { output_variable: input.output_variable, mapped_count: outputNames.length }
}

export async function executeReduceLlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; item_count: number }> {
  const items = await contextManager.resolveManifestItems(context.sessionID, input.variable_name)
  const parts: string[] = []
  for (const item of items) {
    parts.push(await contextManager.readBlobContent(item))
  }
  const subcall = await deps.runSyncSubcall({
    client: options.client,
    parentSessionID: context.sessionID,
    defaultDirectory: options.directory,
    title: "RLM reduce_llm",
    prompt: fillTemplate(input.prompt, session.query, parts.join("\n\n")),
    agent: options.subcallAgent ?? context.agent,
    model: options.subcallModel,
    abortSignal: context.abort,
  })
  try {
    await contextManager.createBlobVariable(
      context.sessionID,
      { name: input.output_variable, content: resolveSubcallText(subcall) },
      { semanticType: "result" },
    )
  } finally {
    if (subcall.sessionID) {
      deps.cleanupSyncSubcallSession(subcall.sessionID)
    }
  }

  return { output_variable: input.output_variable, item_count: items.length }
}
