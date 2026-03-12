import { afterEach, describe, expect, it, mock } from "bun:test"
import type { CliMatch, SgResult } from "../ast-grep/types"
import { RlmConfigSchema, type RlmConfig } from "../../config/schema/experimental"
import {
  InMemoryRlmManager,
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import { chunkText } from "./plan-utils"

const defaultConfig: RlmConfig = RlmConfigSchema.parse({
  enabled: true,
  max_depth: 3,
})

const runSgMock = mock(async (_input?: unknown): Promise<SgResult> => ({
  matches: [],
  totalMatches: 0,
  truncated: false,
}))

const cliMockFactory = () => ({ runSg: runSgMock })
mock.module("../ast-grep/cli", cliMockFactory)
mock.module("../ast-grep/cli.ts", cliMockFactory)
mock.module(new URL("../ast-grep/cli.ts", import.meta.url).href, cliMockFactory)

const { splitByAst } = await import("./split-strategies")
const { createRlmPlanTool } = await import("./plan-tool")
const { RlmPlanOperationSchema } = await import("./types")

const boundSessionIds = new Set<string>()

afterEach(() => {
  runSgMock.mockReset()
  for (const sessionId of boundSessionIds) {
    unbindTestCoordinator(sessionId)
  }
  boundSessionIds.clear()
})

function bindSession(sessionId: string, manager: InMemoryRlmManager): string {
  const rlmSessionId = testRlmSessionId(sessionId)
  manager.seedSession(createSession(rlmSessionId, "query", "query", 0, 3))
  bindTestCoordinator(sessionId, manager)
  boundSessionIds.add(sessionId)
  return rlmSessionId
}

function createMatch(
  content: string,
  snippet: string,
  language: string,
  column = 0,
): CliMatch {
  const startIndex = content.indexOf(snippet)
  if (startIndex === -1) {
    throw new Error(`snippet not found: ${snippet}`)
  }
  const endIndex = startIndex + snippet.length
  return {
    text: snippet,
    file: `/tmp/test.${language}`,
    lines: snippet,
    language,
    charCount: { leading: 0, trailing: 0 },
    range: {
      byteOffset: {
        start: Buffer.byteLength(content.slice(0, startIndex), "utf8"),
        end: Buffer.byteLength(content.slice(0, endIndex), "utf8"),
      },
      start: { line: 1, column },
      end: { line: 1, column: 0 },
    },
  }
}

describe("splitByAst", () => {
  it("accepts split_code operations in the plan schema", () => {
    expect(
      RlmPlanOperationSchema.safeParse({
        op: "split_code",
        variable_name: "context",
        language: "typescript",
        output_variable: "chunks",
        granularity: "block",
      }).success,
    ).toBe(true)

    expect(
      RlmPlanOperationSchema.safeParse({
        op: "split_code",
        variable_name: "context",
        language: "rust",
        output_variable: "chunks",
      }).success,
    ).toBe(false)
  })

  it("splits TypeScript into top-level declarations in source order", async () => {
    const alpha = "function alpha() {\n  function nested() {}\n}"
    const nested = "function nested() {}"
    const box = "class Box {}"
    const beta = "function beta() {}"
    const content = `${alpha}\n\n${box}\n\n${beta}\n`

    runSgMock.mockImplementation(async (input: unknown): Promise<SgResult> => {
      const options = input as { pattern: string }
      if (options.pattern.includes("class")) {
        return { matches: [createMatch(content, box, "typescript")], totalMatches: 1, truncated: false }
      }
      return {
        matches: [
          createMatch(content, beta, "typescript"),
          createMatch(content, nested, "typescript", 2),
          createMatch(content, alpha, "typescript"),
          createMatch(content, alpha, "typescript"),
        ],
        totalMatches: 4,
        truncated: false,
      }
    })

    expect(await splitByAst(content, "typescript", "block")).toEqual([alpha, box, beta])
  })

  it("splits Python into top-level def/class declarations", async () => {
    const alpha = "def alpha():\n    return 1"
    const box = "class Box:\n    pass"
    const beta = "def beta():\n    def nested():\n        return 2\n    return nested()"
    const nested = "def nested():\n        return 2"
    const content = `${alpha}\n\n${box}\n\n${beta}\n`

    runSgMock.mockImplementation(async (input: unknown): Promise<SgResult> => {
      const options = input as { pattern: string }
      if (options.pattern.includes("class")) {
        return { matches: [createMatch(content, box, "python")], totalMatches: 1, truncated: false }
      }
      return {
        matches: [
          createMatch(content, beta, "python"),
          createMatch(content, nested, "python", 4),
          createMatch(content, alpha, "python"),
        ],
        totalMatches: 3,
        truncated: false,
      }
    })

    expect(await splitByAst(content, "python", "block")).toEqual([alpha, box, beta])
  })

  it("splits Go into top-level func/type declarations", async () => {
    const beta = "func beta() {}"
    const box = "type Box struct {}"
    const alpha = "func alpha() {}"
    const content = `${beta}\n\n${box}\n\n${alpha}\n`

    runSgMock.mockImplementation(async (input: unknown): Promise<SgResult> => {
      const options = input as { pattern: string }
      if (options.pattern.startsWith("type ")) {
        return { matches: [createMatch(content, box, "go")], totalMatches: 1, truncated: false }
      }
      return {
        matches: [createMatch(content, alpha, "go"), createMatch(content, beta, "go")],
        totalMatches: 2,
        truncated: false,
      }
    })

    expect(await splitByAst(content, "go", "block")).toEqual([beta, box, alpha])
  })

  it("falls back to chunkText when ast-grep returns an error", async () => {
    const content = "a".repeat(8105)
    runSgMock.mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: "parse failed",
    })

    expect(await splitByAst(content, "typescript", "function")).toEqual(chunkText(content, 4000))
  })

  it("falls back to chunkText when no valid top-level matches remain", async () => {
    const content = "function outer() {\n  function inner() {}\n}\n"
    runSgMock.mockResolvedValue({
      matches: [createMatch(content, "function inner() {}", "typescript", 2)],
      totalMatches: 1,
      truncated: false,
    })

    expect(await splitByAst(content, "typescript", "function")).toEqual(chunkText(content, 4000))
  })
})

describe("split_code plan operation", () => {
  it("creates blob chunks and a manifest through plan execution", async () => {
    const sessionId = "ses-split-code"
    const manager = new InMemoryRlmManager()
    const rlmSessionId = bindSession(sessionId, manager)
    const alpha = "function alpha() {}"
    const box = "class Box {}"
    const beta = "function beta() {}"
    const content = `${alpha}\n\n${box}\n\n${beta}\n`
    manager.createBlobVariable(rlmSessionId, { name: "context", content })

    runSgMock.mockImplementation(async (input: unknown): Promise<SgResult> => {
      const options = input as { pattern: string }
      if (options.pattern.includes("class")) {
        return { matches: [createMatch(content, box, "typescript")], totalMatches: 1, truncated: false }
      }
      return {
        matches: [createMatch(content, beta, "typescript"), createMatch(content, alpha, "typescript")],
        totalMatches: 2,
        truncated: false,
      }
    })

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })
    const raw = await tool.execute({
      operations: [{ op: "split_code", variable_name: "context", language: "typescript", output_variable: "chunks", granularity: "block" }],
    }, createToolContext(sessionId))

    expect(JSON.parse(raw).error).toBeUndefined()
    const manifestItems = manager.resolveManifestItems(rlmSessionId, "chunks")
    expect(manifestItems.map((item) => item.name)).toEqual(["chunks_0", "chunks_1", "chunks_2"])
    expect(manifestItems.map((item) => manager.readBlobContent(item))).toEqual([alpha, box, beta])
  })

  it("creates an empty manifest for empty input", async () => {
    const sessionId = "ses-split-code-empty"
    const manager = new InMemoryRlmManager()
    const rlmSessionId = bindSession(sessionId, manager)
    manager.createBlobVariable(rlmSessionId, { name: "context", content: "" })

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })
    const raw = await tool.execute({
      operations: [{ op: "split_code", variable_name: "context", language: "typescript", output_variable: "chunks" }],
    }, createToolContext(sessionId))
    const parsed = JSON.parse(raw) as { operation_results: Array<{ item_count: number }> }

    expect(parsed.operation_results[0]?.item_count).toBe(0)
    expect(runSgMock).not.toHaveBeenCalled()
    const manifest = manager.getVariableByName(rlmSessionId, "chunks")
    expect(manifest?.storageKind).toBe("manifest")
    if (!manifest || manifest.storageKind !== "manifest") {
      throw new Error("expected manifest variable")
    }
    expect(manager.readManifest(manifest)).toEqual([])
  })
})
