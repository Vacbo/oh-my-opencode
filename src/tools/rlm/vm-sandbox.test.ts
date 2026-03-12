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
  clearVmSandboxNamespace,
  createVmSandboxRlmReplBackend,
} from "./vm-sandbox"

type TestSession = {
  sessionID: string
  rlmSessionId: string
  manager: InMemoryRlmManager
  rootQuery: string
  taskPrompt: string
}

const boundSessions: TestSession[] = []

function createConfig(overrides: Partial<RlmConfig> = {}): RlmConfig {
  return RlmConfigSchema.parse(overrides)
}

function setupSession(sessionID: string, options: {
  trusted?: boolean
  query?: string
  contextVariableName?: string
  contextContent?: string
} = {}): TestSession {
  const manager = new InMemoryRlmManager()
  const rlmSessionId = testRlmSessionId(sessionID)
  const contextVariableName = options.contextVariableName ?? "context"
  const query = options.query ?? "test query"
  manager.seedSession(createSession(rlmSessionId, query, query, 0, 3))
  manager.createBlobVariable(rlmSessionId, {
    name: contextVariableName,
    content: options.contextContent ?? "seed context",
  })
  bindTestCoordinator(sessionID, manager, {
    trusted: options.trusted ?? true,
    rootQuery: query,
    taskPrompt: query,
    contextVariableName,
  })
  const session = {
    sessionID,
    rlmSessionId,
    manager,
    rootQuery: `${query} root`,
    taskPrompt: `${query} task`,
  }
  boundSessions.push(session)
  return session
}

function createContext(session: TestSession, config: RlmConfig) {
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

afterEach(() => {
  while (boundSessions.length > 0) {
    const session = boundSessions.pop()!
    clearVmSandboxNamespace(session.rlmSessionId)
    unbindTestCoordinator(session.sessionID)
  }
})

describe("vm sandbox RLM repl backend", () => {
  it("reads and overwrites blob variables through getVar/setVar", async () => {
    const session = setupSession("ses-vm-blob")
    const backend = createVmSandboxRlmReplBackend()

    const output = await backend.execute(
      'await setVar("note", await getVar("context")); await setVar("note", "overwritten")',
      createContext(session, createConfig()),
    )

    expect(output).toBe("")
    const variable = session.manager.getVariableByName(session.rlmSessionId, "note")
    expect(variable?.storageKind).toBe("blob")
    if (variable && variable.storageKind === "blob") {
      expect(session.manager.readBlobContent(variable)).toBe("overwritten")
    }
  })

  it("captures small print output and offloads large output", async () => {
    const session = setupSession("ses-vm-print")
    const backend = createVmSandboxRlmReplBackend()

    expect(
      await backend.execute('print("hello"); print("world")', createContext(session, createConfig())),
    ).toBe("hello\nworld\n")

    const offloaded = await backend.execute(
      'print("0123456789".repeat(4))',
      createContext(session, createConfig({
        feedback: { output_threshold_bytes: 16 },
        exec: { trusted_only: true, timeout_ms: 30000, print_limit_bytes: 128 },
      })),
    )
    const parsed = JSON.parse(offloaded) as { ref: string; variableName: string }
    expect(parsed.ref.startsWith("hidden://rlm_plan-")).toBe(true)
    const hidden = session.manager.getVariableByName(session.rlmSessionId, parsed.variableName)
    expect(hidden?.storageKind).toBe("blob")
  })

  it("bridges llm_query through runSyncSubcall", async () => {
    const session = setupSession("ses-vm-llm")
    const cleanupSyncSubcallSession = mock(() => {})
    const runSyncSubcall = mock(async () => ({
      ok: true as const,
      sessionID: "leaf-1",
      textOutput: "leaf answer",
      messages: [],
    }))
    const backend = createVmSandboxRlmReplBackend({
      cleanupSyncSubcallSession,
      runSyncSubcall,
    })

    const output = await backend.execute(
      'print(await llm_query("leaf prompt", { title: "leaf title" }))',
      createContext(session, createConfig()),
    )

    expect(output).toBe("leaf answer\n")
    expect(runSyncSubcall).toHaveBeenCalledTimes(1)
    expect(cleanupSyncSubcallSession).toHaveBeenCalledWith("leaf-1")
  })

  it("rejects exec when trusted mode is required", async () => {
    const session = setupSession("ses-vm-untrusted", { trusted: false })
    const backend = createVmSandboxRlmReplBackend()

    return expect(
      backend.execute('print("blocked")', createContext(session, createConfig())),
    ).rejects.toThrow("exec requires trusted mode")
  })

  it("persists namespace state across exec calls", async () => {
    const session = setupSession("ses-vm-persist")
    const backend = createVmSandboxRlmReplBackend()
    const context = createContext(session, createConfig())

    await backend.execute("counter = 41", context)
    expect(await backend.execute("print(counter + 1)", context)).toBe("42\n")
  })

  it("pre-injects context from the binding variable on first exec", async () => {
    const session = setupSession("ses-vm-context", {
      contextVariableName: "seed",
      contextContent: "seed value",
    })
    const backend = createVmSandboxRlmReplBackend()

    expect(await backend.execute("print(context)", createContext(session, createConfig()))).toBe("seed value\n")
  })

  it("supports top-level await and getQuery", async () => {
    const session = setupSession("ses-vm-await", { query: "summarize this" })
    const backend = createVmSandboxRlmReplBackend()

    const output = await backend.execute(
      'await Promise.resolve(); print(`${getRootQuery()}|${getQuery()}`)',
      createContext(session, createConfig()),
    )

    expect(output).toBe("summarize this root|summarize this task\n")
  })

  it("keeps session namespaces isolated", async () => {
    const first = setupSession("ses-vm-first")
    const second = setupSession("ses-vm-second")
    const backend = createVmSandboxRlmReplBackend()

    await backend.execute("counter = 1", createContext(first, createConfig()))
    expect(await backend.execute("print(typeof counter)", createContext(second, createConfig()))).toBe("undefined\n")
  })

  it("drops persisted state after cleanup", async () => {
    const session = setupSession("ses-vm-cleanup")
    const backend = createVmSandboxRlmReplBackend()
    const context = createContext(session, createConfig())

    await backend.execute("counter = 1", context)
    clearVmSandboxNamespace(session.rlmSessionId)

    expect(await backend.execute("print(typeof counter)", context)).toBe("undefined\n")
  })

  it("blocks dangerous globals from the Appendix C namespace", async () => {
    const session = setupSession("ses-vm-globals")
    const backend = createVmSandboxRlmReplBackend()

    const output = await backend.execute(
      'print(JSON.stringify([typeof process, typeof require, typeof __filename, typeof __dirname, typeof Buffer, typeof globalThis.constructor]))',
      createContext(session, createConfig()),
    )

    expect(output).toBe('["undefined","undefined","undefined","undefined","undefined","undefined"]\n')
  })

  it("surfaces user errors without engine-specific wrapping", async () => {
    const session = setupSession("ses-vm-error")
    const backend = createVmSandboxRlmReplBackend()

    return expect(
      backend.execute('throw new Error("boom")', createContext(session, createConfig())),
    ).rejects.toThrow("boom")
  })

  it("times out runaway execution", async () => {
    const session = setupSession("ses-vm-timeout")
    const backend = createVmSandboxRlmReplBackend()

    return expect(
      backend.execute(
        "while (true) {}",
        createContext(session, createConfig({ exec: { trusted_only: true, timeout_ms: 1000, print_limit_bytes: 128 } })),
      ),
    ).rejects.toThrow("timed out")
  })

  it("allows context mutation to persist across calls", async () => {
    const session = setupSession("ses-vm-context-persist")
    const backend = createVmSandboxRlmReplBackend()
    const context = createContext(session, createConfig())

    await backend.execute('context = context.toUpperCase()', context)
    expect(await backend.execute("print(context)", context)).toBe("SEED CONTEXT\n")
  })

  it("serializes parallel exec for the same session and preserves mutation order", async () => {
    const session = setupSession("ses-vm-serialized")
    const gate = createDeferred<void>()
    const runSyncSubcall = mock(async ({ prompt }) => {
      expect(prompt).toBe("hold")
      await gate.promise
      return { ok: true as const, sessionID: "leaf-hold", textOutput: "done", messages: [] }
    })
    const backend = createVmSandboxRlmReplBackend({
      cleanupSyncSubcallSession: mock(() => {}),
      runSyncSubcall,
    })
    const context = createContext(session, createConfig())

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
