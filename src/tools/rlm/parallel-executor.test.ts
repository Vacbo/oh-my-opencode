import { afterEach, describe, expect, it } from "bun:test"
import { RlmConfigSchema } from "../../config/schema/experimental"
import { createRlmPlanTool } from "./plan-tool"
import {
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  InMemoryRlmManager,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"

const ROOT_SESSION_ID = "ses-parallel-root"
const ROOT_RLM_SESSION_ID = testRlmSessionId(ROOT_SESSION_ID)

function seedManifest(manager: InMemoryRlmManager, count: number): void {
  manager.seedSession(createSession(ROOT_RLM_SESSION_ID, "root query", "task prompt", 0, 3))
  const variableNames = Array.from({ length: count }, (_, index) => {
    const name = `item_${index}`
    manager.createBlobVariable(ROOT_RLM_SESSION_ID, { name, content: `content-${index}` })
    return name
  })
  manager.createManifestVariable(ROOT_RLM_SESSION_ID, { name: "chunks", variableNames })
  bindTestCoordinator(ROOT_SESSION_ID, manager, { rootQuery: "root query", taskPrompt: "task prompt" })
}

function createConfig(overrides: Partial<ReturnType<typeof RlmConfigSchema.parse>> = {}) {
  return RlmConfigSchema.parse({ enabled: true, max_depth: 3, ...overrides })
}

describe("parallel map plan execution", () => {
  afterEach(() => {
    unbindTestCoordinator(ROOT_SESSION_ID)
  })

  it("runs map_llm in parallel with the default concurrency and preserves order", async () => {
    const manager = new InMemoryRlmManager()
    seedManifest(manager, 5)
    const config = createConfig()
    let active = 0
    let maxActive = 0

    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config,
      deps: {
        runSyncSubcall: async (input) => {
          const index = Number.parseInt(input.title.match(/(\d+)\//)?.[1] ?? "1", 10) - 1
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return { ok: true, sessionID: `llm-${index}`, textOutput: `result-${index}`, messages: [] }
        },
      },
    })

    const raw = await tool.execute({
      operations: [{ op: "map_llm", variable_name: "chunks", prompt: "{{item}}", output_variable: "out" }],
    }, createToolContext(ROOT_SESSION_ID))
    const parsed = JSON.parse(raw) as { operation_results: Array<{ mapped_count: number }> }

    expect(config.parallel_map_concurrency).toBe(3)
    expect(parsed.operation_results[0]?.mapped_count).toBe(5)
    expect(maxActive).toBe(3)
    expect(manager.resolveManifestItems(ROOT_RLM_SESSION_ID, "out").map((blob) => manager.readBlobContent(blob))).toEqual([
      "result-0",
      "result-1",
      "result-2",
      "result-3",
      "result-4",
    ])
  })

  it("runs map_rlm in parallel, preserves order, and cleans up child sessions", async () => {
    const manager = new InMemoryRlmManager()
    seedManifest(manager, 4)
    let active = 0
    let maxActive = 0

    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: createConfig({ parallel_map_concurrency: 2 }),
      deps: {
        initRlmSession: async (_contextManager, input) => {
          manager.seedSession(createSession(input.sessionId, input.rootQuery ?? "", input.taskPrompt ?? "", input.depth ?? 0, input.maxDepth))
          manager.createBlobVariable(input.sessionId, { name: "context", content: input.content ?? "" })
          return {
            sessionId: input.sessionId,
            depth: input.depth ?? 0,
            maxDepth: input.maxDepth,
            rootQuery: input.rootQuery ?? "",
            taskPrompt: input.taskPrompt ?? "",
            shouldDistill: false,
            contextMetadata: { contextVariableName: "context", contextSize: 0, contextType: "content", lineCount: 1 },
          }
        },
        runSyncSubcall: async (input) => {
          const index = Number.parseInt(input.title.match(/(\d+)\//)?.[1] ?? "1", 10) - 1
          const childSessionId = `child-${index}`
          active += 1
          maxActive = Math.max(maxActive, active)
          await input.onSessionCreated?.(childSessionId)
          manager.createBlobVariable(childSessionId, { name: "answer", content: `child-result-${index}` })
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return { ok: true, sessionID: childSessionId, textOutput: "FINAL_VAR(answer)", messages: [] }
        },
      },
    })

    await tool.execute({
      operations: [{ op: "map_rlm", variable_name: "chunks", prompt: "{{item}}", output_variable: "out" }],
    }, createToolContext(ROOT_SESSION_ID))

    expect(maxActive).toBe(2)
    expect(manager.resolveManifestItems(ROOT_RLM_SESSION_ID, "out").map((blob) => manager.readBlobContent(blob))).toEqual([
      "child-result-0",
      "child-result-1",
      "child-result-2",
      "child-result-3",
    ])
    expect(manager.deletedSessions.sort()).toEqual(["child-0", "child-1", "child-2", "child-3"])
  })

  it("reports all map failures without creating partial output", async () => {
    const manager = new InMemoryRlmManager()
    seedManifest(manager, 4)
    const started: number[] = []

    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: createConfig({ parallel_map_concurrency: 2 }),
      deps: {
        runSyncSubcall: async (input) => {
          const index = Number.parseInt(input.title.match(/(\d+)\//)?.[1] ?? "1", 10) - 1
          started.push(index)
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (index === 1 || index === 3) {
            return { ok: false, error: `boom-${index}`, sessionID: `llm-${index}` }
          }
          return { ok: true, sessionID: `llm-${index}`, textOutput: `result-${index}`, messages: [] }
        },
      },
    })

    const raw = await tool.execute({
      operations: [{ op: "map_llm", variable_name: "chunks", prompt: "{{item}}", output_variable: "out" }],
    }, createToolContext(ROOT_SESSION_ID))
    const parsed = JSON.parse(raw) as { code: string; message: string }

    expect(started.sort()).toEqual([0, 1, 2, 3])
    expect(parsed.code).toBe("PLAN_OP_FAILED")
    expect(parsed.message).toContain("boom-1")
    expect(parsed.message).toContain("boom-3")
    expect(manager.getVariableByName(ROOT_RLM_SESSION_ID, "out")).toBeUndefined()
  })
})
