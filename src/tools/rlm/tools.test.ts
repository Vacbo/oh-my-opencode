import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmBlobVariable, RlmContextVariable, RlmManifestVariable } from "../../features/rlm-context/types"
import { coordinator, type RlmContextManagerLike } from "../../features/rlm-context/coordinator"
import { createRlmSearchTool, type RlmSearchToolOptions } from "./search-tool"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toEqual: (expected: unknown) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  expect: (value: unknown) => ExpectChain
  it: (name: string, fn: () => void | Promise<void>) => void
  afterEach: (fn: () => void) => void
}

const bunTestSpecifier = "bun:test"
const { describe, expect, it, afterEach } = (await import(bunTestSpecifier)) as BunTestModule

const SESSION_ID = "ses-test"

function createBlobVariable(name: string, lineCount: number): RlmBlobVariable {
  return {
    sessionId: SESSION_ID,
    name,
    storageKind: "blob",
    semanticType: "context",
    createdAt: 1,
    filePath: `${name}.blob`,
    byteSize: 0,
    source: "content",
    lineCount,
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
    itemCount: 2,
  }
}

function createManager(state: {
  variables: Record<string, RlmContextVariable>
  blobContents: Record<string, string>
}): RlmContextManagerLike {
  return {
    getVariableByName: async (_sessionId: string, name: string) => state.variables[name],
    readBlobContent: async (variable: RlmBlobVariable) => state.blobContents[variable.name] ?? "",
    // Stub methods not used by search tool
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

describe("createRlmSearchTool", () => {
  afterEach(() => {
    coordinator.unbind(SESSION_ID)
  })

  it("supports literal search and returns bounded context around matches", async () => {
    const manager = createManager({
      variables: { context: createBlobVariable("context", 4) },
      blobContents: { context: "alpha\nneedle one\nneedle two\nomega" },
    })
    bindManager(manager)
    const tool = createRlmSearchTool()

    const raw = await tool.execute(
      { variable_name: "context", pattern: "needle", mode: "literal", max_results: 10 },
      createToolContext(),
    )
    const result = JSON.parse(raw) as {
      mode: string
      result_count: number
      truncated: boolean
      matches: Array<{ line_number: number; context_before: Array<{ line_number: number }> }>
    }

    expect(result.mode).toBe("literal")
    expect(result.result_count).toBe(2)
    expect(result.truncated).toBe(false)
    expect(result.matches.map((match) => match.line_number)).toEqual([2, 3])
    expect(result.matches[0].context_before.map((line) => line.line_number)).toEqual([1])
  })

  it("supports regex search evaluated line-by-line", async () => {
    const manager = createManager({
      variables: { context: createBlobVariable("context", 4) },
      blobContents: { context: "foo_1\nbar\nfoo_2\nbaz" },
    })
    bindManager(manager)
    const tool = createRlmSearchTool()

    const raw = await tool.execute(
      { variable_name: "context", pattern: "^foo_\\d$", mode: "regex" },
      createToolContext(),
    )
    const result = JSON.parse(raw) as { result_count: number; matches: Array<{ line_number: number }> }

    expect(result.result_count).toBe(2)
    expect(result.matches.map((match) => match.line_number)).toEqual([1, 3])
  })

  it("bounds match results by max_results", async () => {
    const manager = createManager({
      variables: { context: createBlobVariable("context", 5) },
      blobContents: { context: "match\nmatch\nmatch\nnomatch\nnomatch" },
    })
    bindManager(manager)
    const tool = createRlmSearchTool()

    const raw = await tool.execute(
      { variable_name: "context", pattern: "match", mode: "literal", max_results: 2 },
      createToolContext(),
    )
    const result = JSON.parse(raw) as { result_count: number; truncated: boolean; matches: Array<{ line_number: number }> }

    expect(result.result_count).toBe(2)
    expect(result.truncated).toBe(true)
    expect(result.matches.map((match) => match.line_number)).toEqual([1, 2])
  })

  it("returns explicit error JSON for manifest variables", async () => {
    const manager = createManager({
      variables: { chunks: createManifestVariable("chunks") },
      blobContents: {},
    })
    bindManager(manager)
    const tool = createRlmSearchTool()

    const raw = await tool.execute(
      { variable_name: "chunks", pattern: "needle", mode: "literal" },
      createToolContext(),
    )
    const result = JSON.parse(raw) as { error: string; storage_kind: string }

    expect(result.error).toBe("unsupported_variable_kind")
    expect(result.storage_kind).toBe("manifest")
  })

  it("returns timeout error JSON when regex guard timeout is exceeded", async () => {
    let tick = 0
    const manager = createManager({
      variables: { context: createBlobVariable("context", 3) },
      blobContents: { context: "one\ntwo\nthree" },
    })
    bindManager(manager)
    const options: RlmSearchToolOptions = {
      regexTimeoutMs: 1,
      now: () => {
        tick += 2
        return tick
      },
    }
    const tool = createRlmSearchTool(options)

    const raw = await tool.execute(
      { variable_name: "context", pattern: "one", mode: "regex" },
      createToolContext(),
    )
    const result = JSON.parse(raw) as { error: string }

    expect(result.error).toBe("regex_timeout")
  })

  it("returns guard failure JSON when regex line-scan guard is exceeded", async () => {
    const manager = createManager({
      variables: { context: createBlobVariable("context", 3) },
      blobContents: { context: "a\nb\nc" },
    })
    bindManager(manager)
    const tool = createRlmSearchTool({ maxRegexLines: 1 })

    const raw = await tool.execute(
      { variable_name: "context", pattern: "z", mode: "regex" },
      createToolContext(),
    )
    const result = JSON.parse(raw) as { error: string; reason: string }

    expect(result.error).toBe("regex_guard_failure")
    expect(result.reason).toBe("line_limit_exceeded")
  })
})
