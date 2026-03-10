import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createRlmProbeTool } from "../../tools/rlm/probe-tool"
import { coordinator, type RlmBinding } from "./coordinator"
import { RlmContextManager } from "./manager"

type ExpectChain = {
  toBe: (expected: unknown) => void
}

type BunTestModule = {
  afterEach: (fn: () => void) => void
  describe: (name: string, fn: () => void) => void
  expect: (value: unknown) => ExpectChain
  it: (name: string, fn: () => void | Promise<void>) => void
}

const bunTestSpecifier = "bun:test"
const { afterEach, describe, expect, it } = (await import(bunTestSpecifier)) as BunTestModule

type TurnFeedbackModule = {
  applyFeedback: (
    output: string,
    sessionID: string,
    toolName: string,
    binding: RlmBinding | undefined,
    config: unknown,
  ) => Promise<string>
}

const SESSION_ID = "ses-turn-feedback"
const tempDirs: string[] = []
const turnFeedbackModulePath = "./turn-feedback"

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-turn-feedback-"))
  tempDirs.push(directory)
  return directory
}

function createToolContext(): ToolContext {
  return {
    sessionID: SESSION_ID,
    messageID: "msg-turn-feedback",
    agent: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext
}

async function loadTurnFeedback(): Promise<TurnFeedbackModule> {
  try {
    return (await import(turnFeedbackModulePath)) as TurnFeedbackModule
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Cannot find module") && message.includes(turnFeedbackModulePath)) {
      throw new Error("turn-feedback is not implemented yet")
    }
    throw error
  }
}

async function createBinding(): Promise<RlmBinding> {
  const manager = new RlmContextManager()
  await manager.initSession(SESSION_ID, {
    contextDir: createTempDir(),
    maxDepth: 2,
    query: "test query",
  })

  const binding: RlmBinding = {
    manager,
    rlmSessionId: SESSION_ID,
    depth: 0,
    query: "test query",
    contextVariableName: "context",
    trusted: true,
  }
  coordinator.bind(SESSION_ID, binding)
  return binding
}

afterEach(() => {
  coordinator.unbind(SESSION_ID)
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("turn-feedback", () => {
  it("large output is offloaded to hidden ref when binding exists", async () => {
    const { applyFeedback } = await loadTurnFeedback()
    const binding = await createBinding()
    const output = "x".repeat(400)

    const raw = await applyFeedback(output, SESSION_ID, "rlm_search", coordinator.resolve(SESSION_ID), {
      feedback: { output_threshold_bytes: 32 },
    })
    const result = JSON.parse(raw)

    expect(result.ref.startsWith("hidden://rlm_search-")).toBe(true)
    expect(result.variableName.startsWith("__hidden_rlm_search-")).toBe(true)
    expect(result.preview).toBe(output.slice(0, 200))

    const stored = await binding.manager.getVariableByName(SESSION_ID, result.variableName)
    expect(stored?.storageKind).toBe("blob")
    expect(stored && "name" in stored ? stored.name : undefined).toBe(result.variableName)
  })

  it("small output passes through unchanged", async () => {
    const { applyFeedback } = await loadTurnFeedback()
    await createBinding()
    const output = JSON.stringify({ ok: true, message: "small" })

    const result = await applyFeedback(output, SESSION_ID, "rlm_probe", coordinator.resolve(SESSION_ID), {
      feedback: { output_threshold_bytes: 2048 },
    })

    expect(result).toBe(output)
  })

  it("rlm_finish output always passes through", async () => {
    const { applyFeedback } = await loadTurnFeedback()
    await createBinding()
    const output = "terminal result".repeat(50)

    const result = await applyFeedback(output, SESSION_ID, "rlm_finish", coordinator.resolve(SESSION_ID), {
      feedback: { output_threshold_bytes: 8 },
    })

    expect(result).toBe(output)
  })

  it("inspect_ref via probe returns bounded preview", async () => {
    const { applyFeedback } = await loadTurnFeedback()
    await createBinding()
    const tool = createRlmProbeTool()
    const output = "0123456789".repeat(40)

    const offloaded = JSON.parse(
      await applyFeedback(output, SESSION_ID, "rlm_search", coordinator.resolve(SESSION_ID), {
        feedback: { output_threshold_bytes: 16 },
      }),
    )

    const raw = await tool.execute({ operation: "inspect_ref", ref: offloaded.ref }, createToolContext())
    const result = JSON.parse(raw)

    expect(result.operation).toBe("inspect_ref")
    expect(result.ref).toBe(offloaded.ref)
    expect(result.preview).toBe(output.slice(0, 200))
    expect(result.preview.length).toBe(200)
  })
})
