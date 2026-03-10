import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { createRlmFinishTool } from "./tools"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void | Promise<void>) => void
  afterEach: (fn: () => void) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { describe, expect, it, afterEach } = (await import(bunTestSpecifier)) as BunTestModule

const SESSION_ID = "ses-test"

function createBlobVariable(name: string): RlmBlobVariable {
  return {
    sessionId: SESSION_ID,
    name,
    storageKind: "blob",
    semanticType: "result",
    createdAt: 1,
    filePath: `${name}.blob`,
    byteSize: 0,
    source: "content",
    lineCount: 1,
  }
}

function createManifestVariable(name: string): RlmManifestVariable {
  return {
    sessionId: SESSION_ID,
    name,
    storageKind: "manifest",
    semanticType: "derived",
    createdAt: 1,
    filePath: `${name}.manifest.json`,
    byteSize: 0,
    itemCount: 1,
  }
}

function createManager(state: {
  variables?: Record<string, RlmContextVariable>
  blobContents?: Record<string, string>
}): RlmContextManagerLike {
  return {
    getVariableByName: async (_sessionId: string, name: string) => state.variables?.[name],
    readBlobContent: async (variable: RlmBlobVariable) => state.blobContents?.[variable.name] ?? "",
    // Stub methods not used by finish tool
    readManifest: async (_variable: RlmManifestVariable) => [],
    listVariables: async () => [],
    initSession: async () => { throw new Error("not used") },
    getSession: async () => undefined,
    createBlobVariable: async () => { throw new Error("not used") },
    createManifestVariable: async () => { throw new Error("not used") },
    resolveManifestItems: async () => [],
    deleteSession: async () => {},
  }
}

function createToolContext(): ToolContext {
  return {
    sessionID: SESSION_ID,
    messageID: "msg-test",
    agent: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext
}

function bindManager(manager: RlmContextManagerLike): void {
  coordinator.bind(SESSION_ID, {
    manager,
    rlmSessionId: SESSION_ID,
    depth: 0,
    query: "test",
    contextVariableName: "context",
    trusted: true,
  })
}

describe("createRlmFinishTool", () => {
  afterEach(() => {
    coordinator.unbind(SESSION_ID)
  })

  it("#when variable_name is provided #then returns blob content as terminal payload", async () => {
    const manager = createManager({
      variables: { final_summary: createBlobVariable("final_summary") },
      blobContents: { final_summary: "resolved final content" },
    })
    bindManager(manager)
    const tool = createRlmFinishTool()

    const raw = await tool.execute({ variable_name: "final_summary" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result).toEqual({
      final_answer: "resolved final content",
      source: "variable",
      terminal: true,
    })
  })

  it("#when value is provided #then returns literal terminal payload", async () => {
    bindManager(createManager({}))
    const tool = createRlmFinishTool()

    const raw = await tool.execute({ value: "literal final answer" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result).toEqual({
      final_answer: "literal final answer",
      source: "literal",
      terminal: true,
    })
  })

  it("#when both variable_name and value are provided #then returns invalid_arguments", async () => {
    bindManager(createManager({}))
    const tool = createRlmFinishTool()

    const raw = await tool.execute(
      { variable_name: "final_summary", value: "literal" },
      createToolContext(),
    )
    const result = JSON.parse(raw)

    expect(result.error).toBe("invalid_arguments")
  })

  it("#when neither variable_name nor value is provided #then returns invalid_arguments", async () => {
    bindManager(createManager({}))
    const tool = createRlmFinishTool()

    const raw = await tool.execute({}, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("invalid_arguments")
  })

  it("#when variable does not exist #then returns variable_not_found", async () => {
    bindManager(createManager({ variables: {} }))
    const tool = createRlmFinishTool()

    const raw = await tool.execute({ variable_name: "missing" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("variable_not_found")
  })

  it("#when variable is a manifest #then rejects manifest as finish target", async () => {
    const manager = createManager({
      variables: { chunks: createManifestVariable("chunks") },
    })
    bindManager(manager)
    const tool = createRlmFinishTool()

    const raw = await tool.execute({ variable_name: "chunks" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("manifest_not_allowed")
  })
})
