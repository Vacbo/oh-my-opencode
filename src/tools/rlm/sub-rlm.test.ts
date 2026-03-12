import { afterEach, describe, expect, it, mock } from "bun:test"
import { createSessionBudget } from "../../features/rlm-context/budget"
import { coordinator, type RlmBinding } from "../../features/rlm-context/coordinator"
import type { RlmTracer } from "../../features/rlm-context/tracer"
import { RlmConfigSchema, type RlmConfig } from "../../config/schema/experimental"
import {
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  InMemoryRlmManager,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import { createSubRlm } from "./sub-rlm"

const SESSION_ID = "ses-sub-rlm"
const RLM_SESSION_ID = testRlmSessionId(SESSION_ID)

function createConfig(overrides: Partial<RlmConfig> = {}): RlmConfig {
  return RlmConfigSchema.parse({ enabled: true, max_depth: 3, ...overrides })
}

function createContext(manager: InMemoryRlmManager, config: RlmConfig) {
  return {
    sessionID: SESSION_ID,
    rlmSessionId: RLM_SESSION_ID,
    rootQuery: "root query",
    taskPrompt: "root query",
    manager,
    toolContext: createToolContext(SESSION_ID),
    client: dummyClient,
    directory: "/tmp",
    config,
  }
}

function createTracerRecorder(): { tracer: RlmTracer; ended: Array<{ status: "ok" | "error"; error?: string }> } {
  const ended: Array<{ status: "ok" | "error"; error?: string }> = []
  const spans = new Map<string, ReturnType<RlmTracer["startSpan"]>>()
  return {
    tracer: {
      startSpan(chatSessionId, rlmSessionId, operation, parentSpanId, update) {
        const spanId = `span-${spans.size + 1}`
        const span = { spanId, chatSessionId, rlmSessionId, operation, parentSpanId, startTime: 0, status: "ok" as const, ...update }
        spans.set(spanId, span)
        return span
      },
      endSpan(spanId, status, error) {
        if (!spans.has(spanId)) return
        const span = spans.get(spanId)!
        span.status = status
        ended.push({ status, error })
      },
      getSpans() {
        return []
      },
      getTrace() {
        return undefined
      },
    },
    ended,
  }
}

function setupSession(options: { depth?: number; maxDepth?: number; tracer?: RlmBinding["tracer"] } = {}): InMemoryRlmManager {
  const manager = new InMemoryRlmManager()
  manager.seedSession(createSession(RLM_SESSION_ID, "root query", "root query", options.depth ?? 0, options.maxDepth ?? 3))
  manager.createBlobVariable(RLM_SESSION_ID, { name: "context", content: "seed context" })
  bindTestCoordinator(SESSION_ID, manager, { tracer: options.tracer })
  return manager
}

function createRecursiveInit(manager: InMemoryRlmManager) {
  return mock(async (_contextManager, input) => {
    manager.seedSession(createSession(input.sessionId, "root query", input.query ?? "", input.depth ?? 0, input.maxDepth))
    manager.createBlobVariable(input.sessionId, { name: "context", content: input.content ?? "" })
    return {
      sessionId: input.sessionId,
      depth: input.depth ?? 0,
      maxDepth: input.maxDepth,
      rootQuery: "root query",
      taskPrompt: input.query ?? "",
      shouldDistill: false,
      parentSessionId: input.parentSessionId,
      contextMetadata: { contextVariableName: "context", contextSize: 0, contextType: "content", lineCount: 1 },
    }
  })
}

async function expectRejectMessage<T>(promise: Promise<T>, message: string): Promise<void> {
  let error: unknown
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe(message)
}

afterEach(() => {
  unbindTestCoordinator(SESSION_ID)
})

describe("createSubRlm", () => {
  it("downgrades to a plain LM subcall when depth is exhausted", async () => {
    const manager = setupSession({ depth: 1, maxDepth: 2 })
    const runSyncSubcall = mock(async (input) => {
      expect(input.prompt).toContain("child query")
      expect(input.prompt).toContain("literal context")
      expect(input.title).toBe("leaf title")
      return { ok: true as const, sessionID: "leaf-1", textOutput: "leaf answer", messages: [] }
    })
    const cleanupSyncSubcallSession = mock(() => {})
    const initRlmSession = mock(async () => {
      throw new Error("should not initialize recursive child when downgraded")
    })
    const subRlm = createSubRlm(createContext(manager, createConfig()), { cleanupSyncSubcallSession, initRlmSession, now: () => 0, runSyncSubcall })

    expect(await subRlm("child query", "literal context", { title: "leaf title" })).toBe("leaf answer")
    expect(initRlmSession).not.toHaveBeenCalled()
    expect(manager.deletedSessions).toEqual([])
    expect(cleanupSyncSubcallSession).toHaveBeenCalledWith("leaf-1")
  })

  it("inherits remaining wall time and enforces subcall_limit", async () => {
    const config = createConfig({ subcall_limit: 1, subcall_timeout_ms: 1000 })
    const manager = setupSession({ depth: 1, maxDepth: 2 })
    const budget = createSessionBudget(config, RLM_SESSION_ID, 0)
    budget.max_wall_time_ms = 90
    budget.wall_time_start_ms = 0
    coordinator.initializeRootBudget(SESSION_ID, budget)
    const runSyncSubcall = mock(async (input) => {
      expect(input.timeoutMs).toBe(30)
      return { ok: true as const, sessionID: "leaf-2", textOutput: "ok", messages: [] }
    })
    const subRlm = createSubRlm(createContext(manager, config), { cleanupSyncSubcallSession: mock(() => {}), now: () => 60, runSyncSubcall })

    expect(await subRlm("first", "context")).toBe("ok")
    await expectRejectMessage(subRlm("second", "context"), "sub_rlm exceeded subcall_limit (1)")
    expect(runSyncSubcall).toHaveBeenCalledTimes(1)
  })

  it("creates recursive child sessions, resolves FINAL_VAR, and cleans up", async () => {
    const recorder = createTracerRecorder()
    const manager = setupSession({ tracer: recorder.tracer })
    const cleanupCalls: string[] = []
    const runSyncSubcall = mock(async (input) => {
      await input.onSessionCreated?.("child-1")
      manager.createBlobVariable("child-1", { name: "answer", content: "child answer" })
      return { ok: true as const, sessionID: "child-1", textOutput: "FINAL_VAR(answer)", messages: [] }
    })
    const subRlm = createSubRlm(createContext(manager, createConfig()), {
      cleanupSyncSubcallSession: (sessionId) => cleanupCalls.push(sessionId),
      initRlmSession: createRecursiveInit(manager),
      now: () => 0,
      runSyncSubcall,
    })

    expect(await subRlm("child query", "context", { title: "child title" })).toBe("child answer")
    expect(manager.deletedSessions).toEqual(["child-1"])
    expect(cleanupCalls).toEqual(["child-1"])
    expect(coordinator.resolve("child-1")).toBeUndefined()
    expect(recorder.ended.some(({ status }) => status === "ok")).toBe(true)
  })

  it("cleans up recursive child sessions when result resolution fails", async () => {
    const recorder = createTracerRecorder()
    const manager = setupSession({ tracer: recorder.tracer })
    const cleanupCalls: string[] = []
    const runSyncSubcall = mock(async (input) => {
      await input.onSessionCreated?.("child-err")
      return { ok: true as const, sessionID: "child-err", textOutput: "FINAL_VAR(missing)", messages: [] }
    })
    const subRlm = createSubRlm(createContext(manager, createConfig()), {
      cleanupSyncSubcallSession: (sessionId) => cleanupCalls.push(sessionId),
      initRlmSession: createRecursiveInit(manager),
      now: () => 0,
      runSyncSubcall,
    })

    await expectRejectMessage(subRlm("child query", "context"), "variable not found: missing")
    expect(manager.deletedSessions).toEqual(["child-err"])
    expect(cleanupCalls).toEqual(["child-err"])
    expect(coordinator.resolve("child-err")).toBeUndefined()
    expect(recorder.ended.some(({ status }) => status === "error")).toBe(true)
  })
})
