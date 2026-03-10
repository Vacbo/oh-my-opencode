import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { createRlmProbeTool } from "./tools"

type ExpectChain = {
  toBe: (expected: unknown) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  it: (name: string, fn: () => void | Promise<void>) => void
  afterEach: (fn: () => void) => void
  expect: (value: unknown) => ExpectChain
}

const bunTestSpecifier = "bun:test"
const { describe, expect, it, afterEach } = (await import(bunTestSpecifier)) as BunTestModule

const SESSION_ID = "ses-1"

function createFixtureManager(): RlmContextManagerLike {
  const variables = new Map<string, RlmContextVariable>()
  const blobContents = new Map<string, string>()
  const manifests = new Map<string, string[]>()

  const blob: RlmBlobVariable = {
    sessionId: SESSION_ID,
    name: "context",
    storageKind: "blob",
    semanticType: "context",
    createdAt: 1,
    filePath: "context.blob",
    byteSize: 100,
    source: "content",
    lineCount: 5,
  }
  variables.set(blob.name, blob)
  blobContents.set(blob.name, "line-1\nline-2\nline-3\nline-4\nline-5")

  const manifest: RlmManifestVariable = {
    sessionId: SESSION_ID,
    name: "parts",
    storageKind: "manifest",
    semanticType: "derived",
    createdAt: 2,
    filePath: "parts.manifest.json",
    byteSize: 20,
    itemCount: 2,
  }
  variables.set(manifest.name, manifest)
  manifests.set(manifest.name, ["chunk-1", "chunk-2"])

  return {
    getVariableByName: async (targetSessionId: string, name: string) =>
      targetSessionId === SESSION_ID ? variables.get(name) : undefined,
    readBlobContent: async (variable: RlmBlobVariable) => blobContents.get(variable.name) ?? "",
    readManifest: async (variable: RlmManifestVariable) => manifests.get(variable.name) ?? [],
    listVariables: async (targetSessionId: string) =>
      targetSessionId === SESSION_ID ? Array.from(variables.values()) : [],
    // Stub plan methods — not used by probe tool
    initSession: async () => { throw new Error("not used") },
    getSession: async () => undefined,
    createBlobVariable: async () => { throw new Error("not used") },
    createManifestVariable: async () => { throw new Error("not used") },
    resolveManifestItems: async () => [],
    deleteSession: async () => {},
  }
}

describe("createRlmProbeTool", () => {
  afterEach(() => {
    coordinator.unbind(SESSION_ID)
  })

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

  function bindFixture(): void {
    coordinator.bind(SESSION_ID, {
      manager: createFixtureManager(),
      rlmSessionId: SESSION_ID,
      depth: 0,
      query: "test",
      contextVariableName: "context",
      trusted: true,
    })
  }

  it("bounds head and tail output by probe_max_lines", async () => {
    bindFixture()
    const tool = createRlmProbeTool({ probe_max_lines: 2 })

    const headRaw = await tool.execute(
      { operation: "head", variable_name: "context", lines: 5 },
      createToolContext(),
    )
    const tailRaw = await tool.execute(
      { operation: "tail", variable_name: "context", lines: 5 },
      createToolContext(),
    )

    const head = JSON.parse(headRaw)
    const tail = JSON.parse(tailRaw)

    expect(head.returned_lines).toBe(2)
    expect(head.content).toBe("line-1\nline-2")
    expect(tail.returned_lines).toBe(2)
    expect(tail.content).toBe("line-4\nline-5")
  })

  it("bounds slice output by probe_max_lines", async () => {
    bindFixture()
    const tool = createRlmProbeTool({ probe_max_lines: 2 })

    const raw = await tool.execute(
      { operation: "slice", variable_name: "context", start: 1, end: 4 },
      createToolContext(),
    )
    const parsed = JSON.parse(raw)

    expect(parsed.operation).toBe("slice")
    expect(parsed.returned_lines).toBe(2)
    expect(parsed.content).toBe("line-2\nline-3")
  })

  it("supports stats for manifest variables", async () => {
    bindFixture()
    const tool = createRlmProbeTool({ probe_max_lines: 20 })

    const raw = await tool.execute(
      { operation: "stats", variable_name: "parts" },
      createToolContext(),
    )
    const parsed = JSON.parse(raw)

    expect(parsed.operation).toBe("stats")
    expect(parsed.storage_kind).toBe("manifest")
    expect(parsed.item_count).toBe(2)
  })

  it("allows list_vars without variable_name and caps previews", async () => {
    bindFixture()
    const tool = createRlmProbeTool({ probe_max_lines: 2 })

    const raw = await tool.execute({ operation: "list_vars" }, createToolContext())
    const parsed = JSON.parse(raw)

    const contextEntry = parsed.variables.find((entry: { name: string }) => entry.name === "context")
    expect(contextEntry.preview_line_count).toBe(2)
    expect(contextEntry.preview).toBe("line-1\nline-2")
  })

  it("returns JSON errors for invalid storage kind", async () => {
    bindFixture()
    const tool = createRlmProbeTool({ probe_max_lines: 2 })

    const raw = await tool.execute(
      { operation: "head", variable_name: "parts", lines: 1 },
      createToolContext(),
    )
    const parsed = JSON.parse(raw)

    expect(parsed.error).toBe("invalid_storage_kind")
    expect(parsed.expected_storage_kind).toBe("blob")
  })
})
