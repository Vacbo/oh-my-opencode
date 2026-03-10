import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import type { RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
  type SyncSubcallInput,
} from "./subcall-runner"

export interface RlmReplContext {
  sessionID: string
  query: string
  manager: RlmContextManagerLike
  toolContext: ToolContext
  client: unknown
  directory: string
  config: RlmConfig
}

export interface RlmReplBackend {
  execute(code: string, context: RlmReplContext): Promise<string>
}

interface RlmReplBackendDeps {
  runSyncSubcall: typeof runSyncSubcall
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
}

const DEFAULT_EXEC_TIMEOUT_MS = 30000

const namespaces = new Map<string, Record<string, unknown>>()
const initializedSessions = new Set<string>()

function getOrCreateNamespace(sessionID: string): Record<string, unknown> {
  let ns = namespaces.get(sessionID)
  if (!ns) {
    ns = {}
    namespaces.set(sessionID, ns)
  }
  return ns
}

export function clearRlmReplNamespace(sessionID: string): void {
  namespaces.delete(sessionID)
  initializedSessions.delete(sessionID)
}

export function createTrustedLocalRlmReplBackend(
  deps: Partial<RlmReplBackendDeps> = {},
): RlmReplBackend {
  const runSyncSubcallFn = deps.runSyncSubcall ?? runSyncSubcall
  const cleanupSyncSubcallSessionFn =
    deps.cleanupSyncSubcallSession ?? cleanupSyncSubcallSession

  return {
    async execute(code: string, context: RlmReplContext): Promise<string> {
      const execConfig = context.config.exec ?? {
        trusted_only: true,
        timeout_ms: DEFAULT_EXEC_TIMEOUT_MS,
        print_limit_bytes: context.config.feedback?.output_threshold_bytes ?? 2048,
      }

      const timeoutMs = execConfig.timeout_ms ?? DEFAULT_EXEC_TIMEOUT_MS
      const printLimitBytes =
        execConfig.print_limit_bytes ??
        context.config.feedback?.output_threshold_bytes ??
        2048

      const { coordinator } = await import(
        "../../features/rlm-context/coordinator"
      )
      const binding = coordinator.resolve(context.sessionID)

      if (!binding) {
        throw new Error("session_not_found")
      }

      if (execConfig.trusted_only && !binding.trusted) {
        throw new Error("exec requires trusted mode")
      }

      const ns = getOrCreateNamespace(context.sessionID)

      if (!initializedSessions.has(context.sessionID)) {
        const contextVar = await context.manager.getVariableByName(
          context.sessionID,
          binding.contextVariableName,
        )
        if (contextVar && contextVar.storageKind === "blob") {
          const content = await context.manager.readBlobContent(contextVar)
          ns.context = content
        }
        initializedSessions.add(context.sessionID)
      }

      const printBuffer: string[] = []

      const globals = {
        getVar: async (name: string): Promise<string> => {
          const variable = await context.manager.getVariableByName(
            context.sessionID,
            name,
          )
          if (!variable) {
            throw new Error(`variable_not_found: ${name}`)
          }
          if (variable.storageKind !== "blob") {
            throw new Error(`invalid_storage_kind: ${name} is not a blob`)
          }
          return context.manager.readBlobContent(variable)
        },
        setVar: async (name: string, value: string): Promise<void> => {
          await context.manager.createBlobVariable(
            context.sessionID,
            { name, content: value },
            { semanticType: "scratch" },
          )
        },
        llm_query: async (
          prompt: string,
          options?: { title?: string; max_tokens?: number },
        ): Promise<string> => {
          const input: SyncSubcallInput = {
            client: context.client as SyncSubcallInput["client"],
            parentSessionID: context.sessionID,
            defaultDirectory: context.directory,
            title: options?.title ?? "RLM leaf query",
            prompt,
            agent: "sisyphus",
            tools: {
              rlm_finish: false,
              rlm_plan: false,
              rlm_probe: false,
              rlm_search: false,
            },
            abortSignal: context.toolContext.abort,
          }

          const result = await runSyncSubcallFn(input)

          if (!result.ok) {
            throw new Error(`llm_query failed: ${result.error}`)
          }

          if (result.sessionID) {
            await cleanupSyncSubcallSessionFn(result.sessionID)
          }

          return result.textOutput
        },
        print: (value: unknown): void => {
          printBuffer.push(String(value))
        },
        getQuery: (): string => context.query,
        context: ns.context,
      }

      const fullCode = `
        const { getVar, setVar, llm_query, print, getQuery, context } = __rlm_injected__;
        ${code}
      `
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
      const fn = new AsyncFunction("__rlm_injected__", fullCode)

      const executePromise = fn(globals)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("exec_timeout")), timeoutMs)
      })

      await Promise.race([executePromise, timeoutPromise])

      let output = printBuffer.join("\n")
      if (output && !output.endsWith("\n")) {
        output += "\n"
      }

      const outputBytes = Buffer.byteLength(output, "utf8")
      if (outputBytes > printLimitBytes) {
        output = await applyFeedback(
          output,
          context.sessionID,
          "rlm_plan",
          binding,
          context.config,
        )
      }

      return output
    },
  }
}
