import type { ToolContext } from "@opencode-ai/plugin/tool"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import type { RlmSessionState } from "../../features/rlm-context/types"
import type { RlmPlanExecutorDeps } from "./plan-deps"
import type { RlmPlanToolOptions } from "./plan-tool"
import {
  logDynamicDepthAdvisory,
  persistOutputs,
  resolveRecursiveOutput,
  runParallelMap,
  throwAggregateMapError,
} from "./parallel-map-shared"
import { fillTemplate, resolveSubcallText } from "./plan-utils"

type MapInput = { variable_name: string; prompt: string; output_variable: string }

export async function executeParallelMapLlmOperation(
  contextManager: RlmContextManagerLike,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  input: MapInput,
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number }> {
  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const concurrency = options.config?.parallel_map_concurrency ?? 3
  const tracer = coordinator.resolve(context.sessionID)?.tracer
  const { staged, failures } = await runParallelMap(items, concurrency, async (item, index) => {
    const itemSpan = tracer?.startSpan(context.sessionID, rlmSessionId, `map_llm.item.${index}`)
    let sessionId: string | undefined
    try {
      const itemContent = await contextManager.readBlobContent(item)
      coordinator.incrementSubcallCount(context.sessionID)
      const subcall = await deps.runSyncSubcall({
        client: options.client,
        parentSessionID: context.sessionID,
        defaultDirectory: options.directory,
        title: `RLM map_llm ${index + 1}/${items.length}`,
        prompt: fillTemplate(input.prompt, { rootQuery: session.rootQuery, taskPrompt: session.taskPrompt }, itemContent),
        agent: options.subcallAgent ?? context.agent,
        model: options.subcallModel,
        abortSignal: context.abort,
        timeoutMs: options.config?.subcall_timeout_ms,
        pollIntervalMs: options.config?.subcall_poll_interval_ms,
        backoffMultiplier: options.config?.subcall_backoff_multiplier,
        jitterPercent: options.config?.subcall_jitter_percent,
        maxIntervalMs: options.config?.subcall_max_interval_ms,
      })
      sessionId = subcall.sessionID
      const content = resolveSubcallText(subcall)
      coordinator.addOutputBytes(context.sessionID, Buffer.byteLength(content, "utf8"))
      tracer?.endSpan(itemSpan!.spanId, "ok")
      return { index, content }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      tracer?.endSpan(itemSpan!.spanId, "error", message)
      throw error
    } finally {
      if (sessionId) {
        deps.cleanupSyncSubcallSession(sessionId)
      }
    }
  })

  if (failures.length > 0) {
    throwAggregateMapError("map_llm", failures)
  }
  await persistOutputs(contextManager, rlmSessionId, input.output_variable, staged)
  return { output_variable: input.output_variable, mapped_count: staged.length }
}

export async function executeParallelMapRlmOperation(
  contextManager: RlmContextManagerLike,
  options: RlmPlanToolOptions,
  context: ToolContext,
  rlmSessionId: string,
  session: RlmSessionState,
  input: MapInput,
  deps: RlmPlanExecutorDeps,
): Promise<{ output_variable: string; mapped_count: number; downgraded_to?: string }> {
  logDynamicDepthAdvisory(context.sessionID, session)
  if (session.depth + 1 >= session.maxDepth) {
    const downgraded = await executeParallelMapLlmOperation(contextManager, options, context, rlmSessionId, session, input, deps)
    return { ...downgraded, downgraded_to: "map_llm" }
  }

  const items = await contextManager.resolveManifestItems(rlmSessionId, input.variable_name)
  const concurrency = options.config?.parallel_map_concurrency ?? 3
  const tracer = coordinator.resolve(context.sessionID)?.tracer
  const { staged, failures } = await runParallelMap(items, concurrency, async (item, index) => {
    const itemSpan = tracer?.startSpan(context.sessionID, rlmSessionId, `map_rlm.item.${index}`)
    let childSessionId: string | undefined
    try {
      const itemContent = await contextManager.readBlobContent(item)
      const childTaskPrompt = fillTemplate(input.prompt, { rootQuery: session.rootQuery, taskPrompt: session.taskPrompt }, itemContent)
      coordinator.incrementSubcallCount(context.sessionID)
      const subcall = await deps.runSyncSubcall({
        client: options.client,
        parentSessionID: context.sessionID,
        defaultDirectory: options.directory,
        title: `RLM map_rlm ${index + 1}/${items.length}`,
        prompt: childTaskPrompt,
        agent: options.subcallAgent ?? context.agent,
        model: options.subcallModel,
        abortSignal: context.abort,
        timeoutMs: options.config?.subcall_timeout_ms,
        pollIntervalMs: options.config?.subcall_poll_interval_ms,
        backoffMultiplier: options.config?.subcall_backoff_multiplier,
        jitterPercent: options.config?.subcall_jitter_percent,
        maxIntervalMs: options.config?.subcall_max_interval_ms,
        onSessionCreated: async (createdSessionId) => {
          childSessionId = createdSessionId
          await deps.initRlmSession(contextManager, {
            sessionId: createdSessionId,
            query: childTaskPrompt,
            content: itemContent,
            depth: session.depth + 1,
            parentSessionId: session.sessionId,
            maxDepth: session.maxDepth,
            contextDir: session.contextDir,
            shouldDistill: session.shouldDistill,
          })
          const parentBinding = coordinator.resolve(context.sessionID)
          if (parentBinding) {
            coordinator.bind(createdSessionId, {
              manager: parentBinding.manager,
              rlmSessionId: createdSessionId,
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
      childSessionId = subcall.sessionID ?? childSessionId
      if (!subcall.sessionID) {
        throw new Error("Recursive child session was not created")
      }
      const content = await resolveRecursiveOutput(contextManager, subcall.sessionID, subcall, deps)
      coordinator.addOutputBytes(context.sessionID, Buffer.byteLength(content, "utf8"))
      tracer?.endSpan(itemSpan!.spanId, "ok")
      return { index, content }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      tracer?.endSpan(itemSpan!.spanId, "error", message)
      throw error
    } finally {
      if (childSessionId) {
        coordinator.unbind(childSessionId)
        await contextManager.deleteSession(childSessionId)
        deps.cleanupSyncSubcallSession(childSessionId)
      }
    }
  })

  if (failures.length > 0) {
    throwAggregateMapError("map_rlm", failures)
  }
  await persistOutputs(contextManager, rlmSessionId, input.output_variable, staged)
  return { output_variable: input.output_variable, mapped_count: staged.length }
}
