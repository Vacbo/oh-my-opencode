import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import vm from "node:vm"
import type { RlmConfig } from "../../config/schema/experimental"
import { applyFeedback } from "../../features/rlm-context/turn-feedback"
import { assertExecTrusted, resolveRlmExecConfig } from "./repl-exec-config"
import {
  readBlobContent,
  truncatePrintedOutput,
} from "./repl-variable-bridge"
import type { RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import type { RlmReplBackend } from "./repl-runtime"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"
import { SessionLock } from "./session-lock"
import { installExecNamespace } from "./exec-namespace"

type RlmSubcallModel = { providerID: string; modelID: string; variant?: string }
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
const sessionLock = new SessionLock()

export interface VmSandboxContext {
  sessionID: string
  rlmSessionId: string
  query: string
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
      const release = await sessionLock.acquire(context.rlmSessionId)
      try {
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
        installExecutionSurface(sandbox.namespace, context as VmSandboxContext, runtimeDeps, (chunk) => {
          printed = truncatePrintedOutput(printed, chunk, execConfig.print_limit_bytes)
        })
        if (sandbox.mode === "vm") {
          await executeInVm(code, sandbox.context, runtimeDeps, execConfig.timeout_ms)
        } else {
          await executeInFallback(code, sandbox.namespace, execConfig.timeout_ms)
        }

        return applyFeedback(printed, context.rlmSessionId, "rlm_plan", binding, context.config)
      } finally {
        release()
      }
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
  installExecNamespace(namespace, context, context.config, appendPrinted, deps)
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
