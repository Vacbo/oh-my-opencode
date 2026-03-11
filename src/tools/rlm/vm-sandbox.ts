import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import vm from "node:vm"
import type { RlmConfig } from "../../config/schema/experimental"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { assertExecTrusted, resolveRlmExecConfig } from "./repl-exec-config"
import {
  formatPrintedValue,
  readBlobContent,
  toStoredContent,
  truncatePrintedOutput,
  upsertBlobVariable,
} from "./repl-variable-bridge"
import type { RlmReplBackend, RlmReplContext } from "./repl-runtime"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"

type RlmSubcallModel = { providerID: string; modelID: string; variant?: string }
type RlmLlmQueryOptions = { title?: string }
type AsyncFunctionConstructor = new (...args: string[]) => (scope: Record<string, unknown>) => Promise<unknown>
type SandboxState = { mode: "vm"; context: vm.Context; namespace: Record<string, unknown> } | { mode: "fallback"; namespace: Record<string, unknown> }
type VmSandboxBackendDeps = {
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  createContext: typeof vm.createContext
  runInContext: typeof vm.runInContext
  runSyncSubcall: typeof runSyncSubcall
}

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as AsyncFunctionConstructor
const blockedNames = ["Buffer", "__dirname", "__filename", "process", "require"] as const
const safeFallbackGlobals = new Set(["AggregateError", "Array", "BigInt", "Boolean", "Date", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "Error", "EvalError", "Infinity", "Intl", "isFinite", "isNaN", "JSON", "Map", "Math", "NaN", "Number", "Object", "parseFloat", "parseInt", "Promise", "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol", "SyntaxError", "TypeError", "URIError", "URL", "URLSearchParams", "WeakMap", "WeakSet"])
const sandboxes = new Map<string, SandboxState>()

export interface VmSandboxContext extends RlmReplContext {
  client: PluginInput["client"]
  config: RlmConfig
  subcallModel?: RlmSubcallModel
  toolContext: ToolContext
}

export function clearVmSandboxNamespace(sessionID?: string): void {
  if (sessionID) {
    sandboxes.delete(sessionID)
    return
  }
  sandboxes.clear()
}

export function createVmSandboxRlmReplBackend(
  deps: Partial<VmSandboxBackendDeps> = {},
): RlmReplBackend {
  const runtimeDeps: VmSandboxBackendDeps = {
    cleanupSyncSubcallSession,
    createContext: vm.createContext,
    runInContext: vm.runInContext,
    runSyncSubcall,
    ...deps,
  }

  return {
    execute: async (code, context) => {
      const binding = assertExecTrusted(context.sessionID, context.config)
      const execConfig = resolveRlmExecConfig(context.config)
      const sandbox = sandboxes.get(context.rlmSessionId) ?? createSandbox(context.rlmSessionId, runtimeDeps)
      sandboxes.set(context.rlmSessionId, sandbox)
      if (!("context" in sandbox.namespace)) {
        sandbox.namespace.context = await readBlobContent(
          context.manager,
          context.rlmSessionId,
          binding.contextVariableName,
        )
      }

      let printed = ""
      installExecutionSurface(sandbox.namespace, context, runtimeDeps, (chunk) => {
        printed = truncatePrintedOutput(printed, chunk, execConfig.print_limit_bytes)
      })
      if (sandbox.mode === "vm") {
        await executeInVm(code, sandbox.context, runtimeDeps, execConfig.timeout_ms)
      } else {
        await executeInFallback(code, sandbox.namespace, execConfig.timeout_ms)
      }

      return applyFeedback(printed, context.rlmSessionId, "rlm_plan", binding, context.config)
    },
  }
}

function createSandbox(sessionID: string, deps: VmSandboxBackendDeps): SandboxState {
  const namespace = createNamespace()
  try {
    return {
      mode: "vm",
      context: deps.createContext(namespace, {
        codeGeneration: { strings: false, wasm: false },
        name: `RLM VM ${sessionID}`,
      }),
      namespace,
    }
  } catch {
    return { mode: "fallback", namespace }
  }
}

function createNamespace(): Record<string, unknown> {
  const namespace = Object.create(null) as Record<string, unknown>
  lockDownNamespace(namespace)
  return namespace
}

function lockDownNamespace(namespace: Record<string, unknown>): void {
  Object.defineProperty(namespace, "constructor", {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true,
  })
  namespace.globalThis = namespace
  namespace.self = namespace
  for (const blockedName of blockedNames) {
    namespace[blockedName] = undefined
  }
}

function installExecutionSurface(
  namespace: Record<string, unknown>,
  context: VmSandboxContext,
  deps: VmSandboxBackendDeps,
  appendPrinted: (chunk: string) => void,
): void {
  lockDownNamespace(namespace)
  namespace.getQuery = (): string => context.query
  namespace.getVar = async (name: string): Promise<string> => readBlobContent(context.manager, context.rlmSessionId, name)
  namespace.setVar = async (name: string, value: unknown): Promise<void> => {
    await upsertBlobVariable(context.manager, context.rlmSessionId, name, toStoredContent(value))
    namespace[name] = value
  }
  namespace.llm_query = async (prompt: string, options?: RlmLlmQueryOptions): Promise<string> => {
    const subcall = await deps.runSyncSubcall({
      client: context.client,
      parentSessionID: context.sessionID,
      defaultDirectory: context.directory,
      title: options?.title ?? "RLM llm_query",
      prompt,
      agent: context.subcallAgent ?? context.toolContext.agent,
      model: context.subcallModel,
      tools: { rlm_finish: false, rlm_plan: false, rlm_probe: false, rlm_search: false },
      abortSignal: context.toolContext.abort,
    })
    try {
      if (!subcall.ok) throw new Error(subcall.error)
      return subcall.terminalPayload?.final_answer ?? subcall.textOutput
    } finally {
      if (subcall.sessionID) deps.cleanupSyncSubcallSession(subcall.sessionID)
    }
  }
  namespace.print = (value: unknown): void => {
    appendPrinted(`${formatPrintedValue(value)}\n`)
  }
}

async function executeInVm(
  code: string,
  context: vm.Context,
  deps: VmSandboxBackendDeps,
  timeoutMs: number,
): Promise<void> {
  const options = { timeout: timeoutMs, microtaskMode: "afterEvaluate" } as vm.RunningCodeOptions & { microtaskMode: "afterEvaluate" }
  await Promise.resolve(deps.runInContext(`(async () => { ${code}\n})()`, context, options))
}

async function executeInFallback(code: string, namespace: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const abortSignal = AbortSignal.timeout(timeoutMs)
  const scope = new Proxy(namespace, {
    deleteProperty: (target, property) => Reflect.deleteProperty(target, property),
    get: (target, property, receiver) => {
      if (property === Symbol.unscopables) return undefined
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver)
      if (typeof property === "string" && safeFallbackGlobals.has(property)) return Reflect.get(globalThis, property)
      return undefined
    },
    has: () => true,
    set: (target, property, value) => Reflect.set(target, property, value),
  })
  await Promise.race([
    new AsyncFunction("scope", `with (scope) { ${code} }`)(scope),
    new Promise<never>((_, reject) => {
      abortSignal.addEventListener("abort", () => reject(new Error(`exec timed out after ${timeoutMs}ms`)), { once: true })
    }),
  ])
}
