import { afterEach, describe, expect, it } from "bun:test"
import type { RlmConfig } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import { executeRlmPlan } from "./plan-executor"
import {
  InMemoryRlmManager,
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"

const config: RlmConfig = { enabled: true, max_depth: 3, context_storage_dir: ".sisyphus/rlm-contexts", distill_threshold_tokens: 2000, probe_max_lines: 200 }

type Scenario = {
  manager: InMemoryRlmManager
  rootChatId: string
  rootRlmId: string
  cleanup: string[]
  bindings: Array<{ sessionId: string; depth: number; trusted: boolean; contextVariableName: string; hasItem: boolean }>
  nested: Array<{ sessionId: string; depth: number; downgradedTo?: string }>
  seen: Record<string, string>
  result: { final_variable?: string; operation_results?: Array<{ op?: string; downgraded_to?: string }> }
}

const boundRoots: string[] = []

afterEach(() => {
  while (boundRoots.length > 0) unbindTestCoordinator(boundRoots.pop()!)
})

async function runScenario(maxDepth: 2 | 3): Promise<Scenario> {
  const manager = new InMemoryRlmManager()
  const rootChatId = `ses-depth-${maxDepth}`, rootRlmId = testRlmSessionId(rootChatId)
  manager.seedSession(createSession(rootRlmId, "root query", 0, maxDepth))
  manager.createBlobVariable(rootRlmId, { name: "root_a", content: "alpha" })
  manager.createBlobVariable(rootRlmId, { name: "root_b", content: "beta" })
  manager.createManifestVariable(rootRlmId, { name: "root_chunks", variableNames: ["root_a", "root_b"] })
  bindTestCoordinator(rootChatId, manager, { query: "root query", trusted: true })
  boundRoots.push(rootChatId)

  const cleanup: string[] = []
  const bindings: Scenario["bindings"] = []
  const nested: Scenario["nested"] = []
  const seen: Record<string, string> = {}
  let childCount = 0
  let leafCount = 0

  const options = { client: dummyClient, directory: "/tmp", config }
  const deps = {
    cleanupSyncSubcallSession: (sessionId: string) => {
      cleanup.push(sessionId)
    },
    runSyncSubcall: async (input: { parentSessionID: string; prompt: string; onSessionCreated?: (sessionID: string) => Promise<void> | void }) => {
      if (!input.onSessionCreated) {
        leafCount += 1
        return { ok: true as const, sessionID: `llm-${leafCount}`, textOutput: `leaf:${input.prompt}`, messages: [] }
      }

      childCount += 1
      const childId = `${input.parentSessionID}-sub-${childCount}`
      await input.onSessionCreated(childId)
      const binding = coordinator.resolve(childId)
      if (!binding) throw new Error(`expected binding for ${childId}`)
      bindings.push({
        sessionId: childId,
        depth: binding.depth,
        trusted: binding.trusted,
        contextVariableName: binding.contextVariableName,
        hasItem: !!manager.getVariableByName(childId, "item"),
      })

      manager.createBlobVariable(childId, { name: "part_a", content: `${input.prompt}|A` })
      manager.createBlobVariable(childId, { name: "part_b", content: `${input.prompt}|B` })
      manager.createManifestVariable(childId, { name: "parts", variableNames: ["part_a", "part_b"] })

      const raw = await executeRlmPlan(
        manager,
        options,
        {
          operations: [
            { op: "exec", code: 'print(context)', output_variable: "seen_context" },
            { op: "write_var", variable_name: "private_note", content: `private-${childId}` },
            { op: "map_rlm", variable_name: "parts", prompt: "Q={{query}} I={{item}}", output_variable: "mapped" },
            { op: "concat", variable_name: "mapped", output_variable: "joined" },
            { op: "final_var", variable_name: "joined" },
          ],
        },
        createToolContext(childId),
        deps,
      )
      const parsed = JSON.parse(raw) as Scenario["result"]
      nested.push({
        sessionId: childId,
        depth: binding.depth,
        downgradedTo: parsed.operation_results?.find((result) => result.op === "map_rlm")?.downgraded_to,
      })
      const seenVar = manager.getVariableByName(childId, "seen_context")
      if (!seenVar || seenVar.storageKind !== "blob") throw new Error(`missing exec output for ${childId}`)
      seen[childId] = manager.readBlobContent(seenVar).trim()
      const joinedVar = manager.getVariableByName(childId, "joined")
      if (!joinedVar || joinedVar.storageKind !== "blob") throw new Error(`missing joined output for ${childId}`)
      return { ok: true as const, sessionID: childId, textOutput: `FINAL(${manager.readBlobContent(joinedVar)})`, messages: [] }
    },
  }

  const raw = await executeRlmPlan(
    manager,
    options,
    {
      operations: [
        { op: "map_rlm", variable_name: "root_chunks", prompt: "ROOT={{item}}", output_variable: "root_mapped" },
        { op: "concat", variable_name: "root_mapped", output_variable: "root_joined" },
        { op: "final_var", variable_name: "root_joined" },
      ],
    },
    createToolContext(rootChatId),
    deps,
  )

  return { manager, rootChatId, rootRlmId, cleanup, bindings, nested, seen, result: JSON.parse(raw) as Scenario["result"] }
}

describe("RLM recursive integration depth chains", () => {
  describe("depth-2", () => {
    it("returns two child results via executeRlmPlan", async () => {
      const scenario = await runScenario(2)
      expect(scenario.result.final_variable).toBe("root_joined")
      expect(scenario.manager.resolveManifestItems(scenario.rootRlmId, "root_mapped")).toHaveLength(2)
    })

    it("downgrades child map_rlm to map_llm at depth limit", async () => {
      const scenario = await runScenario(2)
      expect(scenario.nested.map((entry) => entry.downgradedTo)).toEqual(["map_llm", "map_llm"])
    })

    it("inherits trusted mode and binds recursive context as item", async () => {
      const scenario = await runScenario(2)
      expect(scenario.bindings.map(({ depth, trusted, contextVariableName, hasItem }) => ({ depth, trusted, contextVariableName, hasItem }))).toEqual([
        { depth: 1, trusted: true, contextVariableName: "item", hasItem: true },
        { depth: 1, trusted: true, contextVariableName: "item", hasItem: true },
      ])
      expect(Object.values(scenario.seen).sort()).toEqual(["alpha", "beta"])
    })

    it("keeps root bound while child sessions clean up without leaking variables", async () => {
      const scenario = await runScenario(2)
      expect(coordinator.resolve(scenario.rootChatId)?.rlmSessionId).toBe(scenario.rootRlmId)
      expect(scenario.cleanup.filter((sessionId) => sessionId.startsWith("ses-"))).toEqual(["ses-depth-2-sub-1", "ses-depth-2-sub-2"])
      expect(scenario.manager.deletedSessions).toEqual(["ses-depth-2-sub-1", "ses-depth-2-sub-2"])
      expect(scenario.manager.getVariableByName(scenario.rootRlmId, "private_note")).toBeUndefined()
    })
  })

  describe("depth-3", () => {
    it("creates child and grandchild sessions through nested plan execution", async () => {
      const scenario = await runScenario(3)
      expect(scenario.bindings.map((entry) => entry.depth)).toEqual([1, 2, 2, 1, 2, 2])
      expect(scenario.manager.resolveManifestItems(scenario.rootRlmId, "root_mapped")).toHaveLength(2)
    })

    it("downgrades only grandchild map_rlm operations", async () => {
      const scenario = await runScenario(3)
      expect(scenario.nested.map((entry) => entry.downgradedTo)).toEqual(["map_llm", "map_llm", undefined, "map_llm", "map_llm", undefined])
    })

    it("passes the correct item context into each recursive exec", async () => {
      const scenario = await runScenario(3)
      expect(Object.values(scenario.seen).sort()).toEqual([
        "ROOT=alpha|A",
        "ROOT=alpha|B",
        "ROOT=beta|A",
        "ROOT=beta|B",
        "alpha",
        "beta",
      ])
    })

    it("unbinds grandchildren before children while keeping root bound", async () => {
      const scenario = await runScenario(3)
      expect(scenario.cleanup.filter((sessionId) => sessionId.startsWith("ses-"))).toEqual([
        "ses-depth-3-sub-1-sub-2",
        "ses-depth-3-sub-1-sub-3",
        "ses-depth-3-sub-1",
        "ses-depth-3-sub-4-sub-5",
        "ses-depth-3-sub-4-sub-6",
        "ses-depth-3-sub-4",
      ])
      expect(coordinator.resolve(scenario.rootChatId)?.rlmSessionId).toBe(scenario.rootRlmId)
      expect(scenario.manager.getVariableByName(scenario.rootRlmId, "private_note")).toBeUndefined()
    })
  })
})
