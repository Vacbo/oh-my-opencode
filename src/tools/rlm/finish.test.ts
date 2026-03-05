import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import { createRlmFinishTool, type RlmContextManagerForFinish } from "./tools"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void | Promise<void>) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { describe, expect, it } = (await import(bunTestSpecifier)) as BunTestModule

function createBlobVariable(name: string): RlmBlobVariable {
  return {
    sessionId: "ses-test",
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
    sessionId: "ses-test",
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
}): RlmContextManagerForFinish {
  return {
    getVariableByName: async (_sessionId: string, name: string) => state.variables?.[name],
    readBlobContent: async (variable: RlmBlobVariable) => state.blobContents?.[variable.name] ?? "",
  }
}

function createToolContext(): ToolContext {
  return {
    sessionID: "ses-test",
    messageID: "msg-test",
    agent: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  } as ToolContext
}

describe("createRlmFinishTool", () => {
  it("#when variable_name is provided #then returns blob content as terminal payload", async () => {
    const manager = createManager({
      variables: { final_summary: createBlobVariable("final_summary") },
      blobContents: { final_summary: "resolved final content" },
    })
    const tool = createRlmFinishTool(manager)

    const raw = await tool.execute({ variable_name: "final_summary" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result).toEqual({
      final_answer: "resolved final content",
      source: "variable",
      terminal: true,
    })
  })

  it("#when value is provided #then returns literal terminal payload", async () => {
    const tool = createRlmFinishTool(createManager({}))

    const raw = await tool.execute({ value: "literal final answer" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result).toEqual({
      final_answer: "literal final answer",
      source: "literal",
      terminal: true,
    })
  })

  it("#when both variable_name and value are provided #then returns invalid_arguments", async () => {
    const tool = createRlmFinishTool(createManager({}))

    const raw = await tool.execute(
      { variable_name: "final_summary", value: "literal" },
      createToolContext(),
    )
    const result = JSON.parse(raw)

    expect(result.error).toBe("invalid_arguments")
  })

  it("#when neither variable_name nor value is provided #then returns invalid_arguments", async () => {
    const tool = createRlmFinishTool(createManager({}))

    const raw = await tool.execute({}, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("invalid_arguments")
  })

  it("#when variable does not exist #then returns variable_not_found", async () => {
    const tool = createRlmFinishTool(createManager({ variables: {} }))

    const raw = await tool.execute({ variable_name: "missing" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("variable_not_found")
  })

  it("#when variable is a manifest #then rejects manifest as finish target", async () => {
    const manager = createManager({
      variables: { chunks: createManifestVariable("chunks") },
    })
    const tool = createRlmFinishTool(manager)

    const raw = await tool.execute({ variable_name: "chunks" }, createToolContext())
    const result = JSON.parse(raw)

    expect(result.error).toBe("manifest_not_allowed")
  })
})
