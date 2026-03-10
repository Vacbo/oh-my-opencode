import { describe, expect, it, afterEach } from "bun:test"
import { createRlmPlanTool } from "./plan-tool"
import type { RlmConfig } from "../../config/schema/experimental"
import {
  InMemoryRlmManager,
  createSession,
  createToolContext,
  dummyClient,
  bindTestCoordinator,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"

const defaultConfig: RlmConfig = {
  enabled: true,
  max_depth: 3,
  context_storage_dir: ".sisyphus/rlm-contexts",
  distill_threshold_tokens: 2000,
  probe_max_lines: 200,
}

describe("createRlmPlanTool operations", () => {
  it("rejects plans above 50 operations", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession("ses-max-ops", "query", 0, 2))
    bindTestCoordinator("ses-max-ops", manager)
    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })

    const operations = Array.from({ length: 51 }, (_, index) => ({
      op: "write_var" as const,
      variable_name: `v_${index}`,
      content: `${index}`,
    }))

    const raw = await tool.execute({ operations }, createToolContext("ses-max-ops"))
    unbindTestCoordinator("ses-max-ops")
    const parsed = JSON.parse(raw) as { error: string; max_operations: number; operation_count: number }
    expect(parsed.error).toBe("too_many_operations")
    expect(parsed.max_operations).toBe(50)
    expect(parsed.operation_count).toBe(51)
  })

  it("write_var creates a blob variable from literal content", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession("ses-write", "query", 0, 2))
    bindTestCoordinator("ses-write", manager)

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })
    const raw = await tool.execute(
      { operations: [{ op: "write_var", variable_name: "note", content: "hello world" }] },
      createToolContext("ses-write"),
    )
    unbindTestCoordinator("ses-write")

    expect(JSON.parse(raw).error).toBeUndefined()
    const variable = manager.getVariableByName("ses-write", "note")
    expect(variable?.storageKind).toBe("blob")
    if (!variable || variable.storageKind !== "blob") {
      throw new Error("expected blob variable")
    }
    expect(manager.readBlobContent(variable)).toBe("hello world")
  })

  it("map_llm applies templates and creates a result manifest", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession("ses-map-llm", "Persisted query", 0, 3))
    manager.createBlobVariable("ses-map-llm", { name: "item_a", content: "alpha" })
    manager.createBlobVariable("ses-map-llm", { name: "item_b", content: "beta" })
    manager.createManifestVariable("ses-map-llm", { name: "chunks", variableNames: ["item_a", "item_b"] })
    bindTestCoordinator("ses-map-llm", manager, { query: "Persisted query" })

    const prompts: string[] = []
    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: defaultConfig,
      deps: {
        runSyncSubcall: async (input) => {
          prompts.push(input.prompt)
          return { ok: true, sessionID: `llm-${prompts.length}`, textOutput: `mapped-${prompts.length}`, messages: [] }
        },
      },
    })

    await tool.execute(
      {
        operations: [{ op: "map_llm", variable_name: "chunks", prompt: "Q={{query}} I={{item}}", output_variable: "mapped" }],
      },
      createToolContext("ses-map-llm"),
    )
    unbindTestCoordinator("ses-map-llm")

    expect(prompts).toEqual(["Q=Persisted query I=alpha", "Q=Persisted query I=beta"])
    const mapped = manager.resolveManifestItems("ses-map-llm", "mapped")
    expect(mapped.map((blob) => manager.readBlobContent(blob))).toEqual(["mapped-1", "mapped-2"])
  })

  it("concat joins manifest items into one blob", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession("ses-concat", "query", 0, 2))
    manager.createBlobVariable("ses-concat", { name: "first", content: "left" })
    manager.createBlobVariable("ses-concat", { name: "second", content: "right" })
    manager.createManifestVariable("ses-concat", { name: "parts", variableNames: ["first", "second"] })
    bindTestCoordinator("ses-concat", manager)

    const tool = createRlmPlanTool({ client: dummyClient, directory: "/tmp", config: defaultConfig })
    await tool.execute(
      {
        operations: [{ op: "concat", variable_name: "parts", output_variable: "joined" }],
      },
      createToolContext("ses-concat"),
    )
    unbindTestCoordinator("ses-concat")

    const joined = manager.getVariableByName("ses-concat", "joined")
    expect(joined?.storageKind).toBe("blob")
    if (!joined || joined.storageKind !== "blob") {
      throw new Error("expected blob variable")
    }
    expect(manager.readBlobContent(joined)).toBe("left\nright")
  })

  it("reduce_llm aggregates manifest items via one subcall", async () => {
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession("ses-reduce", "Root query", 0, 3))
    manager.createBlobVariable("ses-reduce", { name: "a", content: "one" })
    manager.createBlobVariable("ses-reduce", { name: "b", content: "two" })
    manager.createManifestVariable("ses-reduce", { name: "items", variableNames: ["a", "b"] })
    bindTestCoordinator("ses-reduce", manager, { query: "Root query" })

    const prompts: string[] = []
    const tool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config: defaultConfig,
      deps: {
        runSyncSubcall: async (input) => {
          prompts.push(input.prompt)
          return { ok: true, sessionID: "reduce-1", textOutput: "reduced", messages: [] }
        },
      },
    })

    await tool.execute(
      {
        operations: [{ op: "reduce_llm", variable_name: "items", prompt: "Q={{query}} ITEMS={{item}}", output_variable: "summary" }],
      },
      createToolContext("ses-reduce"),
    )
    unbindTestCoordinator("ses-reduce")

    expect(prompts).toEqual(["Q=Root query ITEMS=one\n\ntwo"])
    const summary = manager.getVariableByName("ses-reduce", "summary")
    expect(summary?.storageKind).toBe("blob")
    if (!summary || summary.storageKind !== "blob") {
      throw new Error("expected blob variable")
    }
    expect(manager.readBlobContent(summary)).toBe("reduced")
  })
})
