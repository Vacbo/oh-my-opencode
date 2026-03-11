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

function createConfig(overrides: Partial<RlmConfig> = {}): RlmConfig {
  return RlmConfigSchema.parse(overrides)
}

function createContext(manager: InMemoryRlmManager, config: RlmConfig) {
  return {
    sessionID: SESSION_ID,
    rlmSessionId: RLM_SESSION_ID,
    query: "test query",
    manager,
    toolContext: createToolContext(SESSION_ID),
    client: dummyClient,
    directory: "/tmp",
    config,
  }
}

function setupSession(options: {
  trusted?: boolean
  contextVariableName?: string
  contextContent?: string
} = {}): InMemoryRlmManager {
  const manager = new InMemoryRlmManager()
  const contextVariableName = options.contextVariableName ?? "context"
  manager.seedSession(createSession(RLM_SESSION_ID, "test query", 0, 3))
  manager.createBlobVariable(RLM_SESSION_ID, {
    name: contextVariableName,
    content: options.contextContent ?? "seed context",
  })
  bindTestCoordinator(SESSION_ID, manager, {
    trusted: options.trusted ?? true,
    contextVariableName,
  })
  return manager
}

afterEach(() => {
  clearRlmReplNamespace(RLM_SESSION_ID)
  unbindTestCoordinator(SESSION_ID)
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

    await expect(
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
})
