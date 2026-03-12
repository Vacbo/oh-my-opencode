import type { ToolContext } from "@opencode-ai/plugin/tool"
import { shouldReduceDepth } from "../../features/rlm-context/budget"
import type { RlmSessionState } from "../../features/rlm-context/types"
import { log } from "../../shared/logger"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import type { SyncSubcallResult } from "./subcall-runner"
import { fillTemplate, itemVariableName, requireBlob, resolveSubcallText } from "./plan-utils"
import { coordinator } from "../../features/rlm-context/coordinator"
import { executeParallelMapLlm } from "./parallel-map-llm"

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

function logDynamicDepthAdvisory(chatSessionId: string, session: RlmSessionState): void {
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

export async function executeMapLlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number }> {
  const { sessionID: chatSessionId } = context
  const tracer = coordinator.resolve(chatSessionId)?.tracer
  if (options.config?.parallel?.enabled) {
    return executeParallelMapLlm(contextManager, options, context, rlmSessionId, session, input, deps)
  }

  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const outputNames: string[] = []
  for (let index = 0; index < items.length; index += 1) {
    const itemSpan = tracer?.startSpan(chatSessionId, rlmSessionId, `map_llm.item.${index}`)
    const itemContent = await contextManager.readBlobContent(items[index])
    coordinator.incrementSubcallCount(chatSessionId)
    const subcall = await deps.runSyncSubcall({
      client: options.client,
      parentSessionID: chatSessionId,
      defaultDirectory: options.directory,
      title: `RLM map_llm ${index + 1}/${items.length}`,
      prompt: fillTemplate(input.prompt, { rootQuery: session.rootQuery, taskPrompt: session.taskPrompt }, itemContent),
      agent: options.subcallAgent ?? context.agent,
      model: options.subcallModel,
      abortSignal: context.abort,
      timeoutMs: options.config?.subcall_timeout_ms,
      pollIntervalMs: options.config?.subcall_poll_interval_ms,
    })
    try {
      const outputName = itemVariableName(input.output_variable, index)
      const outputContent = resolveSubcallText(subcall)
      coordinator.addOutputBytes(chatSessionId, Buffer.byteLength(outputContent, "utf8"))
      await contextManager.createBlobVariable(
        rlmSessionId,
        { name: outputName, content: outputContent },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
      tracer?.endSpan(itemSpan!.spanId, "ok")
    } finally {
      if (subcall.sessionID) {
        deps.cleanupSyncSubcallSession(subcall.sessionID)
      }
    }
  }
  await contextManager.createManifestVariable(
    rlmSessionId,
    { name: input.output_variable, variableNames: outputNames },
    { semanticType: "result" },
  )

  return { output_variable: input.output_variable, mapped_count: outputNames.length }
}

export async function executeMapRlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number; downgraded_to?: string }> {
  const { sessionID: chatSessionId } = context
  const tracer = coordinator.resolve(chatSessionId)?.tracer
  logDynamicDepthAdvisory(chatSessionId, session)
  if (session.depth + 1 >= session.maxDepth) {
    const downgraded = await executeMapLlmOperation(contextManager, options, context, rlmSessionId, session, input, deps)
    return { ...downgraded, downgraded_to: "map_llm" }
  }
  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const outputNames: string[] = []
  for (let index = 0; index < items.length; index += 1) {
    const itemSpan = tracer?.startSpan(chatSessionId, rlmSessionId, `map_rlm.item.${index}`)
    const itemContent = await contextManager.readBlobContent(items[index])
    const childTaskPrompt = fillTemplate(input.prompt, { rootQuery: session.rootQuery, taskPrompt: session.taskPrompt }, itemContent)
    coordinator.incrementSubcallCount(chatSessionId)
    const subcall = await deps.runSyncSubcall({
      client: options.client,
      parentSessionID: chatSessionId,
      defaultDirectory: options.directory,
      title: `RLM map_rlm ${index + 1}/${items.length}`,
      prompt: childTaskPrompt,
      agent: options.subcallAgent ?? context.agent,
      model: options.subcallModel,
      abortSignal: context.abort,
      timeoutMs: options.config?.subcall_timeout_ms,
      pollIntervalMs: options.config?.subcall_poll_interval_ms,
      onSessionCreated: async (childSessionID) => {
        await deps.initRlmSession(contextManager, {
          sessionId: childSessionID,
          query: childTaskPrompt,
          content: itemContent,
          depth: session.depth + 1,
          parentSessionId: session.sessionId,
          maxDepth: session.maxDepth,
          contextDir: session.contextDir,
          shouldDistill: session.shouldDistill,
        })
        // Bind child session through coordinator with inherited trust.
        // Resolve parent binding to get the full RlmContextManager instance.
        const parentBinding = coordinator.resolve(chatSessionId)
        if (parentBinding) {
          coordinator.bind(childSessionID, {
            manager: parentBinding.manager,
            rlmSessionId: childSessionID,
            rootRlmSessionId: parentBinding.rootRlmSessionId,
            depth: session.depth + 1,
            rootQuery: session.rootQuery,
            taskPrompt: childTaskPrompt,
            contextVariableName: "item",
            trusted: parentBinding.trusted,
            budget: parentBinding.budget,
            tracer: parentBinding.tracer,
          })
        }
      },
    })
    try {
      if (!subcall.sessionID) {
        throw new Error("Recursive child session was not created")
      }
      const outputName = itemVariableName(input.output_variable, index)
      const outputContent = await resolveRecursiveOutput(contextManager, subcall.sessionID, subcall, deps)
      coordinator.addOutputBytes(chatSessionId, Buffer.byteLength(outputContent, "utf8"))
      await contextManager.createBlobVariable(
        rlmSessionId,
        {
          name: outputName,
          content: outputContent,
        },
        { semanticType: "result" },
      )
      outputNames.push(outputName)
      tracer?.endSpan(itemSpan!.spanId, "ok")
    } finally {
      if (subcall.sessionID) {
        coordinator.unbind(subcall.sessionID)
        await contextManager.deleteSession(subcall.sessionID)
        deps.cleanupSyncSubcallSession(subcall.sessionID)
      }
    }
  }
  await contextManager.createManifestVariable(
    rlmSessionId,
    { name: input.output_variable, variableNames: outputNames },
    { semanticType: "result" },
  )

  return { output_variable: input.output_variable, mapped_count: outputNames.length }
}

export async function executeReduceLlmOperation(
  contextManager: RlmContextManagerForPlan,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  input: { variable_name: string; prompt: string; output_variable: string },
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; item_count: number }> {
  const { sessionID: chatSessionId } = context
  const tracer = coordinator.resolve(chatSessionId)?.tracer
  const reduceSpan = tracer?.startSpan(chatSessionId, rlmSessionId, "reduce_llm")
  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const parts: string[] = []
  for (const item of items) {
    parts.push(await contextManager.readBlobContent(item))
  }
  coordinator.incrementSubcallCount(chatSessionId)
  const subcall = await deps.runSyncSubcall({
    client: options.client,
    parentSessionID: chatSessionId,
    defaultDirectory: options.directory,
    title: "RLM reduce_llm",
    prompt: fillTemplate(input.prompt, { rootQuery: session.rootQuery, taskPrompt: session.taskPrompt }, parts.join("\n\n")),
    agent: options.subcallAgent ?? context.agent,
    model: options.subcallModel,
    abortSignal: context.abort,
    timeoutMs: options.config?.subcall_timeout_ms,
    pollIntervalMs: options.config?.subcall_poll_interval_ms,
  })
  try {
    const outputContent = resolveSubcallText(subcall)
    coordinator.addOutputBytes(chatSessionId, Buffer.byteLength(outputContent, "utf8"))
    await contextManager.createBlobVariable(
      rlmSessionId,
      { name: input.output_variable, content: outputContent },
      { semanticType: "result" },
    )
    tracer?.endSpan(reduceSpan!.spanId, "ok")
  } finally {
    if (subcall.sessionID) {
      deps.cleanupSyncSubcallSession(subcall.sessionID)
    }
  }

  return { output_variable: input.output_variable, item_count: items.length }
}
