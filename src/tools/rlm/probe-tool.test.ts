import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { createRlmProbeTool } from "./tools"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
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

  describe("max_bytes and max_tokens bounds", () => {
    function createLargeContentManager(): RlmContextManagerLike {
      const variables = new Map<string, RlmContextVariable>()
      const blobContents = new Map<string, string>()

      const longContent = "abcdefghij".repeat(10)
      const blob: RlmBlobVariable = {
        sessionId: SESSION_ID,
        name: "large",
        storageKind: "blob",
        semanticType: "context",
        createdAt: 1,
        filePath: "large.blob",
        byteSize: longContent.length,
        source: "content",
        lineCount: 1,
      }
      variables.set(blob.name, blob)
      blobContents.set(blob.name, longContent)

      const hiddenBlob: RlmBlobVariable = {
        sessionId: SESSION_ID,
        name: "__hidden_large",
        storageKind: "blob",
        semanticType: "scratch",
        createdAt: 2,
        filePath: "__hidden_large.blob",
        byteSize: longContent.length,
        source: "content",
        lineCount: 1,
      }
      variables.set(hiddenBlob.name, hiddenBlob)
      blobContents.set(hiddenBlob.name, longContent)

      return {
        getVariableByName: async (targetSessionId: string, name: string) =>
          targetSessionId === SESSION_ID ? variables.get(name) : undefined,
        readBlobContent: async (variable: RlmBlobVariable) => blobContents.get(variable.name) ?? "",
        readManifest: async () => [],
        listVariables: async () => [],
        initSession: async () => { throw new Error("not used") },
        getSession: async () => undefined,
        createBlobVariable: async () => { throw new Error("not used") },
        createManifestVariable: async () => { throw new Error("not used") },
        resolveManifestItems: async () => [],
        deleteSession: async () => {},
      }
    }

    function bindLargeContentFixture(): void {
      coordinator.bind(SESSION_ID, {
        manager: createLargeContentManager(),
        rlmSessionId: SESSION_ID,
        depth: 0,
        query: "test",
        contextVariableName: "large",
        trusted: true,
      })
    }

    const defaultProbeConfig = {
      probe_max_lines: 200,
      probe_view_lines: 50,
      probe_list_preview_lines: 3,
      probe_max_ref_preview_chars: 200,
    }

    it("head accepts optional max_bytes and truncates content to byte count", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "head", variable_name: "large", lines: 1, max_bytes: 30 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("head")
      expect(parsed.returned_bytes).toBe(30)
      expect(parsed.content.length).toBe(30)
      expect(parsed.returned_tokens).toBeDefined()
    })

    it("head accepts optional max_tokens and truncates content to estimated token count", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "head", variable_name: "large", lines: 1, max_tokens: 10 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("head")
      expect(parsed.returned_tokens).toBe(10)
      expect(parsed.content.length).toBe(40)
      expect(parsed.returned_bytes).toBe(40)
    })

    it("head when both max_bytes and max_tokens set, most restrictive wins", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "head", variable_name: "large", lines: 1, max_bytes: 50, max_tokens: 5 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.content.length).toBe(20)
      expect(parsed.returned_bytes).toBe(20)
      expect(parsed.returned_tokens).toBe(5)
    })

    it("tail accepts max_bytes and max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "tail", variable_name: "large", lines: 1, max_bytes: 20 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("tail")
      expect(parsed.returned_bytes).toBe(20)
      expect(parsed.content.length).toBe(20)
    })

    it("slice accepts max_bytes and max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "slice", variable_name: "large", start: 0, end: 0, max_tokens: 5 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("slice")
      expect(parsed.returned_tokens).toBe(5)
      expect(parsed.content.length).toBe(20)
    })

    it("existing line-only behavior unchanged when new fields absent", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "head", variable_name: "large", lines: 1 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("head")
      expect(parsed.returned_lines).toBe(1)
      expect(parsed.returned_bytes).toBeDefined()
      expect(parsed.returned_tokens).toBeDefined()
      expect(parsed.content.length).toBe(100)
    })

    it("stats operation is NOT affected by max_bytes/max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "stats", variable_name: "large", max_bytes: 10 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("stats")
      expect(parsed.byte_size).toBe(100)
      expect(parsed.returned_bytes).toBeUndefined()
      expect(parsed.returned_tokens).toBeUndefined()
    })

    it("schema operation is NOT affected by max_bytes/max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "schema", variable_name: "large", max_bytes: 10 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("schema")
      expect(parsed.schema).toBeDefined()
      expect(parsed.returned_bytes).toBeUndefined()
      expect(parsed.returned_tokens).toBeUndefined()
    })

    it("list_vars operation is NOT affected by max_bytes/max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "list_vars", max_bytes: 10 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("list_vars")
      expect(parsed.variables).toBeDefined()
      expect(parsed.returned_bytes).toBeUndefined()
      expect(parsed.returned_tokens).toBeUndefined()
    })

    it("inspect_ref operation is NOT affected by max_bytes/max_tokens", async () => {
      bindLargeContentFixture()
      const tool = createRlmProbeTool(defaultProbeConfig)

      const raw = await tool.execute(
        { operation: "inspect_ref", ref: "hidden://large", max_bytes: 10 },
        createToolContext(),
      )
      const parsed = JSON.parse(raw)

      expect(parsed.operation).toBe("inspect_ref")
      expect(parsed.preview).toBeDefined()
      expect(parsed.returned_bytes).toBeUndefined()
      expect(parsed.returned_tokens).toBeUndefined()
    })
  })
})
