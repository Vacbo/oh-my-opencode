/// <reference types="bun-types" />
import { afterEach, describe, expect, it, mock } from "bun:test"
import {
  RlmConfigSchema,
  type RlmConfig,
} from "../../config/schema/experimental"
import {
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  InMemoryRlmManager,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import {
  clearRlmReplNamespace,
  createTrustedLocalRlmReplBackend,
} from "./repl-runtime"

const SESSION_ID = "ses-repl-runtime"
const RLM_SESSION_ID = testRlmSessionId(SESSION_ID)

type TestSession = {
  sessionID: string
  rlmSessionId: string
  manager: InMemoryRlmManager
  rootQuery: string
  taskPrompt: string
}

const extraSessions: TestSession[] = []

function createConfig(overrides: Partial<RlmConfig> = {}): RlmConfig {
  return RlmConfigSchema.parse(overrides)
}

function createContext(manager: InMemoryRlmManager, config: RlmConfig) {
  return {
    sessionID: SESSION_ID,
    rlmSessionId: RLM_SESSION_ID,
    rootQuery: "root question",
    taskPrompt: "task prompt",
    manager,
    toolContext: createToolContext(SESSION_ID),
    client: dummyClient,
    directory: "/tmp",
    config,
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return
    }
    await Bun.sleep(0)
  }
  throw new Error("condition not met")
}

function setupSession(options: {
  trusted?: boolean
  contextVariableName?: string
  contextContent?: string
  rootQuery?: string
  taskPrompt?: string
} = {}): InMemoryRlmManager {
  const manager = new InMemoryRlmManager()
  const contextVariableName = options.contextVariableName ?? "context"
  const rootQuery = options.rootQuery ?? "test query"
  const taskPrompt = options.taskPrompt ?? "test query"
  manager.seedSession(createSession(RLM_SESSION_ID, rootQuery, taskPrompt, 0, 3))
  manager.createBlobVariable(RLM_SESSION_ID, {
    name: contextVariableName,
    content: options.contextContent ?? "seed context",
  })
  bindTestCoordinator(SESSION_ID, manager, {
    trusted: options.trusted ?? true,
    contextVariableName,
    rootQuery,
    taskPrompt,
  })
  return manager
}

function setupNamedSession(sessionID: string, options: {
  trusted?: boolean
  contextVariableName?: string
  contextContent?: string
  rootQuery?: string
  taskPrompt?: string
} = {}): TestSession {
  const manager = new InMemoryRlmManager()
  const rlmSessionId = testRlmSessionId(sessionID)
  const contextVariableName = options.contextVariableName ?? "context"
  const rootQuery = options.rootQuery ?? "test query"
  const taskPrompt = options.taskPrompt ?? rootQuery
  manager.seedSession(createSession(rlmSessionId, rootQuery, taskPrompt, 0, 3))
  manager.createBlobVariable(rlmSessionId, {
    name: contextVariableName,
    content: options.contextContent ?? "seed context",
  })
  bindTestCoordinator(sessionID, manager, {
    trusted: options.trusted ?? true,
    contextVariableName,
    rootQuery,
    taskPrompt,
  })
  const session = { sessionID, rlmSessionId, manager, rootQuery, taskPrompt }
  extraSessions.push(session)
  return session
}

function createNamedContext(session: TestSession, config: RlmConfig) {
  return {
    sessionID: session.sessionID,
    rlmSessionId: session.rlmSessionId,
    rootQuery: session.rootQuery,
    taskPrompt: session.taskPrompt,
    manager: session.manager,
    toolContext: createToolContext(session.sessionID),
    client: dummyClient,
    directory: "/tmp",
    config,
  }
}

afterEach(() => {
  clearRlmReplNamespace(RLM_SESSION_ID)
  unbindTestCoordinator(SESSION_ID)
  while (extraSessions.length > 0) {
    const session = extraSessions.pop()!
    clearRlmReplNamespace(session.rlmSessionId)
    unbindTestCoordinator(session.sessionID)
  }
})

describe("trusted local RLM repl backend", () => {
  it("reads and overwrites blob variables through getVar/setVar", async () => {
    const manager = setupSession()
    const backend = createTrustedLocalRlmReplBackend()

    const output = await backend.execute(
      'await setVar("note", await getVar("context")); await setVar("note", "overwritten")',
      createContext(manager, createConfig()),
    )

    expect(output).toBe("")
    const variable = manager.getVariableByName(RLM_SESSION_ID, "note")
    if (!variable || variable.storageKind !== "blob") {
      throw new Error("expected blob variable")
    }
    expect(manager.readBlobContent(variable)).toBe("overwritten")
  })

  it("captures small print output and offloads large output", async () => {
    const manager = setupSession()
    const backend = createTrustedLocalRlmReplBackend()

    const smallOutput = await backend.execute(
      'print("hello"); print("world")',
      createContext(manager, createConfig()),
    )
    expect(smallOutput).toBe("hello\nworld\n")

    const offloaded = await backend.execute(
      'print("0123456789".repeat(4))',
      createContext(manager, createConfig({
        feedback: { output_threshold_bytes: 16 },
        exec: { trusted_only: true, timeout_ms: 30000, print_limit_bytes: 128 },
      })),
    )
    const parsed = JSON.parse(offloaded) as {
      ref: string
      variableName: string
      preview: string
    }

    expect(parsed.ref.startsWith("hidden://rlm_plan-")).toBe(true)
    const hidden = manager.getVariableByName(RLM_SESSION_ID, parsed.variableName)
    if (!hidden || hidden.storageKind !== "blob") {
      throw new Error("expected hidden blob variable")
    }
    expect(manager.readBlobContent(hidden)).toBe("0123456789012345678901234567890123456789\n")
  })

  it("bridges llm_query through runSyncSubcall", async () => {
    const manager = setupSession()
    const cleanupSyncSubcallSession = mock(() => {})
    const runSyncSubcall = mock(async (input) => {
      expect(input.title).toBe("leaf title")
      expect(input.prompt).toBe("leaf prompt")
      expect(input.parentSessionID).toBe(SESSION_ID)
      expect(input.defaultDirectory).toBe("/tmp")
      expect(input.agent).toBe("sisyphus")
      expect(input.tools).toEqual({
        rlm_finish: false,
        rlm_plan: false,
        rlm_probe: false,
        rlm_search: false,
      })
      return {
        ok: true as const,
        sessionID: "leaf-1",
        textOutput: "leaf answer",
        messages: [],
      }
    })
    const backend = createTrustedLocalRlmReplBackend({
      cleanupSyncSubcallSession,
      runSyncSubcall,
    })

    const output = await backend.execute(
      'print(await llm_query("leaf prompt", { title: "leaf title" }))',
      createContext(manager, createConfig()),
    )

    expect(output).toBe("leaf answer\n")
    expect(runSyncSubcall).toHaveBeenCalledTimes(1)
    expect(cleanupSyncSubcallSession).toHaveBeenCalledWith("leaf-1")
  })

  it("rejects exec when trusted mode is required", async () => {
    const manager = setupSession({ trusted: false })
    const backend = createTrustedLocalRlmReplBackend()

    return expect(
      backend.execute('print("blocked")', createContext(manager, createConfig())),
    ).rejects.toThrow("exec requires trusted mode")
  })

  it("persists namespace state across exec calls", async () => {
    const manager = setupSession()
    const backend = createTrustedLocalRlmReplBackend()
    const replContext = createContext(manager, createConfig())

    await backend.execute("counter = 41", replContext)
    const output = await backend.execute("print(counter + 1)", replContext)

    expect(output).toBe("42\n")
  })

  it("pre-injects context from the binding variable on first exec", async () => {
    const manager = setupSession({
      contextVariableName: "seed",
      contextContent: "seed value",
    })
    const backend = createTrustedLocalRlmReplBackend()

    const output = await backend.execute(
      "print(context)",
      createContext(manager, createConfig()),
    )

    expect(output).toBe("seed value\n")
  })

  it("returns taskPrompt from getQuery and rootQuery from getRootQuery", async () => {
    const manager = setupSession()
    const backend = createTrustedLocalRlmReplBackend()

    const output = await backend.execute(
      'print(`${getRootQuery()}|${getQuery()}`)',
      createContext(manager, createConfig()),
    )

    expect(output).toBe("root question|task prompt\n")
  })

  it("keeps parallel exec for different sessions isolated", async () => {
    const first = setupNamedSession("ses-repl-parallel-a")
    const second = setupNamedSession("ses-repl-parallel-b")
    const firstGate = createDeferred<void>()
    const secondGate = createDeferred<void>()
    const prompts: string[] = []
    const backend = createTrustedLocalRlmReplBackend({
      cleanupSyncSubcallSession: mock(() => {}),
      runSyncSubcall: mock(async ({ prompt }) => {
        prompts.push(prompt)
        if (prompt === "hold-a") {
          await firstGate.promise
        } else if (prompt === "hold-b") {
          await secondGate.promise
        } else {
          throw new Error(`unexpected prompt: ${prompt}`)
        }
        return { ok: true as const, sessionID: `leaf-${prompt}`, textOutput: "done", messages: [] }
      }),
    })
    const firstContext = createNamedContext(first, createConfig())
    const secondContext = createNamedContext(second, createConfig())

    const firstExec = backend.execute('value = "alpha"; await llm_query("hold-a")', firstContext)
    const secondExec = backend.execute('value = "beta"; await llm_query("hold-b")', secondContext)

    await waitFor(() => prompts.length === 2)

    firstGate.resolve()
    secondGate.resolve()
    await Promise.all([firstExec, secondExec])

    expect(await backend.execute("print(value)", firstContext)).toBe("alpha\n")
    expect(await backend.execute("print(value)", secondContext)).toBe("beta\n")
  })

  it("serializes parallel exec for the same session and preserves mutation order", async () => {
    const session = setupNamedSession("ses-repl-serialized")
    const gate = createDeferred<void>()
    const runSyncSubcall = mock(async ({ prompt }) => {
      expect(prompt).toBe("hold")
      await gate.promise
      return { ok: true as const, sessionID: "leaf-hold", textOutput: "done", messages: [] }
    })
    const backend = createTrustedLocalRlmReplBackend({
      cleanupSyncSubcallSession: mock(() => {}),
      runSyncSubcall,
    })
    const context = createNamedContext(session, createConfig())

    const firstExec = backend.execute(
      'history = ["first"]; await llm_query("hold"); history.push("after-first")',
      context,
    )
    await waitFor(() => runSyncSubcall.mock.calls.length === 1)

    let secondSettled = false
    const secondExec = backend.execute(
      'history.push("second"); print(history.join(","))',
      context,
    ).then(
      (value) => {
        secondSettled = true
        return value
      },
      (error) => {
        secondSettled = true
        throw error
      },
    )

    await Bun.sleep(0)
    expect(secondSettled).toBe(false)

    gate.resolve()

    expect(await firstExec).toBe("")
    expect(await secondExec).toBe("first,after-first,second\n")
    expect(await backend.execute('print(history.join(","))', context)).toBe("first,after-first,second\n")
  })
})
