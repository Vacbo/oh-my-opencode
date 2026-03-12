import { afterEach, describe, expect, it, mock } from "bun:test"
import { RlmConfigSchema } from "../../config/schema/experimental"
import {
  InMemoryRlmManager,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
} from "../../tools/rlm/plan-tool.test-helpers"

const logCalls: Array<{ message: string; data?: unknown }> = []

mock.module("../../shared/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data })
  },
}))

const { coordinator } = await import("./coordinator")
const {
  createSessionBudget,
  shouldReduceDepth,
} = await import("./budget")
const { executeRlmPlan } = await import("../../tools/rlm/plan-executor")

const config = RlmConfigSchema.parse({ enabled: true, max_depth: 3, session_budget: 20 })

function bindSession(
  chatSessionId: string,
  manager: InMemoryRlmManager,
  overrides: Partial<Parameters<typeof coordinator.bind>[1]> = {},
): void {
  coordinator.bind(chatSessionId, {
    manager,
    rlmSessionId: testRlmSessionId(chatSessionId),
    depth: 0,
    rootQuery: "root query",
    taskPrompt: "task prompt",
    contextVariableName: "context",
    trusted: true,
    ...overrides,
  })
}

afterEach(() => {
  logCalls.length = 0
  coordinator.unbind("budget-root")
  coordinator.unbind("budget-child")
  coordinator.unbind("budget-plan")
})

describe("SessionBudget", () => {
  it("creates advisory budgets with root-owned defaults", () => {
    const budget = createSessionBudget(config, "rlm-root")

    expect(budget).toEqual({
      subcall_count: 0,
      output_bytes: 0,
      wall_time_ms: 0,
      wall_time_start_ms: budget.wall_time_start_ms,
      max_subcalls: 20,
      max_output_bytes: 10_000_000,
      max_wall_time_ms: 600_000,
      rootRlmSessionId: "rlm-root",
    })
    expect(budget.wall_time_start_ms).toBeLessThan(1_000_000_000)
  })

  it("tracks a root-owned budget across child bindings", () => {
    const manager = new InMemoryRlmManager()
    const rootRlmSessionId = testRlmSessionId("budget-root")
    const childRlmSessionId = testRlmSessionId("budget-child")
    const budget = createSessionBudget(config, rootRlmSessionId)

    manager.seedSession(createSession(rootRlmSessionId, "root query", "task prompt", 0, 3))
    manager.seedSession(createSession(childRlmSessionId, "root query", "child prompt", 1, 3))

    bindSession("budget-root", manager, { budget, rootRlmSessionId })
    bindSession("budget-child", manager, {
      rlmSessionId: childRlmSessionId,
      depth: 1,
      taskPrompt: "child prompt",
      budget,
      rootRlmSessionId,
    })

    expect(coordinator.getRootBudget("budget-child")).toBe(budget)
    expect(coordinator.incrementSubcallCount("budget-child")).toBe(1)
    expect(coordinator.incrementSubcallCount("budget-root")).toBe(2)
    expect(coordinator.addOutputBytes("budget-child", 128)).toBe(128)
    expect(coordinator.addOutputBytes("budget-root", 64)).toBe(192)
    expect(budget.subcall_count).toBe(2)
    expect(budget.output_bytes).toBe(192)
  })

  it("returns true when advisory budget usage crosses 80 percent", () => {
    const budget = createSessionBudget(config, "rlm-root")
    budget.subcall_count = 17

    expect(shouldReduceDepth(budget, createSession("rlm-root", "root query", "task prompt", 0, 3))).toBe(true)
  })

  it("includes budget in plan results and logs advisory-only warnings", async () => {
    const manager = new InMemoryRlmManager()
    const rootRlmSessionId = testRlmSessionId("budget-plan")
    const budget = createSessionBudget(config, rootRlmSessionId)
    budget.subcall_count = 17

    manager.seedSession(createSession(rootRlmSessionId, "root query", "task prompt", 0, 3))
    manager.createBlobVariable(rootRlmSessionId, { name: "item_0", content: "alpha" })
    manager.createManifestVariable(rootRlmSessionId, { name: "chunks", variableNames: ["item_0"] })

    bindSession("budget-plan", manager, { budget, rootRlmSessionId })

    let createdChildSession = false
    const raw = await executeRlmPlan(
      manager,
      { client: dummyClient, directory: "/tmp", config },
      {
        operations: [
          { op: "map_rlm", variable_name: "chunks", prompt: "Investigate {{item}}", output_variable: "mapped" },
          { op: "final_var", variable_name: "mapped" },
        ],
      },
      createToolContext("budget-plan"),
      {
        initRlmSession: async (_contextManager, input) => {
          const rootQuery = input.rootQuery ?? input.query ?? ""
          const taskPrompt = input.taskPrompt ?? input.query ?? ""
          manager.seedSession(createSession(input.sessionId, rootQuery, taskPrompt, input.depth ?? 0, input.maxDepth))
          manager.createBlobVariable(input.sessionId, { name: "item", content: input.content ?? "" })
          return {
            sessionId: input.sessionId,
            depth: input.depth ?? 0,
            maxDepth: input.maxDepth,
            rootQuery,
            taskPrompt,
            shouldDistill: false,
            contextMetadata: { contextVariableName: "item", contextSize: 0, contextType: "content", lineCount: 1 },
          }
        },
        runSyncSubcall: async (input) => {
          createdChildSession = true
          const childSessionId = `${input.parentSessionID}-child-1`
          await input.onSessionCreated?.(childSessionId)
          return { ok: true as const, sessionID: childSessionId, textOutput: "FINAL(recursive-result)", messages: [] }
        },
      },
    )
    const parsed = JSON.parse(raw) as {
      final_variable: string
      budget: { subcall_count: number; output_bytes: number; wall_time_ms: number }
      operation_results: Array<{ op: string; downgraded_to?: string }>
    }

    expect(createdChildSession).toBe(true)
    expect(parsed.final_variable).toBe("mapped")
    expect(parsed.operation_results[0].downgraded_to).toBeUndefined()
    expect(parsed.budget.subcall_count).toBe(18)
    expect(parsed.budget.output_bytes).toBe(Buffer.byteLength("recursive-result", "utf8"))
    expect(parsed.budget.wall_time_ms).toBeGreaterThanOrEqual(0)
    expect(logCalls.some(({ message }) => message.includes("budget") && message.includes("dynamic depth"))).toBe(true)
  })
})
