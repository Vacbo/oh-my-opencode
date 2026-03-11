import type { RlmConfig } from "../../../config/schema/experimental"
import type {
  RlmBlobVariable,
  RlmContextVariable,
} from "../../../features/rlm-context/types"
import { RlmErrorCode } from "../../../features/rlm-context/error-codes"
import { createRlmFinishTool } from "../finish-tool"
import type { InitRlmSessionResult } from "../init-session"
import { parseFinalAnswer } from "../parser"
import { executeRlmPlan } from "../plan-executor"
import type { RlmPlanExecutorDeps } from "../plan-deps"
import {
  InMemoryRlmManager,
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  testRlmSessionId,
  unbindTestCoordinator,
} from "../plan-tool.test-helpers"
import { createRlmProbeTool } from "../probe-tool"
import { createRlmSearchTool } from "../search-tool"
import type { RlmReplContext } from "../repl-runtime"
import type { BenchmarkDefinition } from "./types"

const BASE_CONFIG: RlmConfig = {
  enabled: true,
  max_depth: 3,
  context_storage_dir: ".sisyphus/rlm-contexts",
  distill_threshold_tokens: 2000,
  probe_max_lines: 200,
}

type Awaitable<T> = T | Promise<T>
type BlobManager = {
  getVariableByName(sessionId: string, name: string): Awaitable<RlmContextVariable | undefined>
  readBlobContent(variable: RlmBlobVariable): Awaitable<string>
}

function setupBenchmark(name: string, query: string, maxDepth = 3, trusted = true) {
  const chatSessionId = `benchmark-${name}`
  const rlmSessionId = testRlmSessionId(chatSessionId)
  const manager = new InMemoryRlmManager()
  manager.seedSession(createSession(rlmSessionId, query, 0, maxDepth))
  bindTestCoordinator(chatSessionId, manager, { query, trusted })
  return { manager, rlmSessionId, context: createToolContext(chatSessionId), release: () => unbindTestCoordinator(chatSessionId) }
}

async function readNamedBlob(manager: BlobManager, sessionId: string, name: string): Promise<string> {
  const variable = await manager.getVariableByName(sessionId, name)
  if (!variable || variable.storageKind !== "blob") {
    throw new Error(`Missing blob variable: ${name}`)
  }
  return manager.readBlobContent(variable)
}

export const splitMapReducePattern: BenchmarkDefinition = {
  name: "Split-Map-Reduce",
  async execute() {
    const env = setupBenchmark("split-map-reduce", "summarize")
    try {
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "context", content: "abcdefghij".repeat(125) })
      const raw = await executeRlmPlan(env.manager, { client: dummyClient, directory: "/tmp", config: BASE_CONFIG }, { operations: [
        { op: "split", variable_name: "context", chunk_size: 500, output_variable: "chunks" },
        { op: "map_llm", variable_name: "chunks", prompt: "Summarize {{item}}", output_variable: "summaries" },
        { op: "reduce_llm", variable_name: "summaries", prompt: "Reduce {{item}}", output_variable: "report" },
        { op: "final_var", variable_name: "report" },
      ] }, env.context, { runSyncSubcall: async (input) => ({ ok: true, sessionID: input.title, textOutput: input.title === "RLM reduce_llm" ? "combined:3" : `summary:${input.title}`, messages: [] }), cleanupSyncSubcallSession: () => {} })
      const parsed = JSON.parse(raw) as { executed_ops: number }
      const chunks = env.manager.resolveManifestItems(env.rlmSessionId, "chunks")
      return { opsCount: parsed.executed_ops, depthReached: 0, passed: chunks.length === 3 && await readNamedBlob(env.manager, env.rlmSessionId, "report") === "combined:3", details: { chunkCount: chunks.length } }
    } finally {
      env.release()
    }
  },
}

export const recursiveDecompositionPattern: BenchmarkDefinition = {
  name: "Recursive Decomposition",
  async execute() {
    const env = setupBenchmark("recursive-decomposition", "root query")
    try {
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "root_a", content: "alpha" })
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "root_b", content: "beta" })
      await env.manager.createManifestVariable(env.rlmSessionId, { name: "root_chunks", variableNames: ["root_a", "root_b"] })
      let childCount = 0
      let opsCount = 0
      let depthReached = 0
      const deps: Partial<RlmPlanExecutorDeps> = {
        parseFinalAnswer,
        cleanupSyncSubcallSession: () => {},
        initRlmSession: async (_manager, input): Promise<InitRlmSessionResult> => {
          env.manager.seedSession(createSession(input.sessionId, input.query, input.depth ?? 0, input.maxDepth))
          if (input.content) {
            await env.manager.createBlobVariable(input.sessionId, { name: "context", content: input.content })
          }
          return {
            sessionId: input.sessionId,
            depth: input.depth ?? 0,
            maxDepth: input.maxDepth,
            query: input.query,
            shouldDistill: input.shouldDistill ?? false,
            parentSessionId: input.parentSessionId,
            contextMetadata: {
              contextVariableName: "context",
              contextSize: input.content?.length ?? 0,
              contextType: "content",
              lineCount: input.content ? input.content.split("\n").length : 0,
            },
          }
        },
        runSyncSubcall: async (input) => {
          if (!input.onSessionCreated) {
            return { ok: true, sessionID: `leaf-${input.title}`, textOutput: `leaf:${input.prompt}`, messages: [] }
          }
          childCount += 1
          const childId = `${input.parentSessionID}-child-${childCount}`
          await input.onSessionCreated(childId)
          const child = env.manager.getSession(childId)
          depthReached = Math.max(depthReached, child?.depth ?? 0)
          if ((child?.depth ?? 0) >= 2) {
            return { ok: true, sessionID: childId, textOutput: `FINAL(leaf:${input.prompt})`, messages: [] }
          }
          await env.manager.createBlobVariable(childId, { name: "part_a", content: `${input.prompt}:A` })
          await env.manager.createBlobVariable(childId, { name: "part_b", content: `${input.prompt}:B` })
          await env.manager.createManifestVariable(childId, { name: "parts", variableNames: ["part_a", "part_b"] })
          const raw = await executeRlmPlan(env.manager, { client: dummyClient, directory: "/tmp", config: BASE_CONFIG }, { operations: [
            { op: "map_rlm", variable_name: "parts", prompt: "DEEP={{item}}", output_variable: "mapped" },
            { op: "concat", variable_name: "mapped", output_variable: "joined" },
            { op: "final_var", variable_name: "joined" },
          ] }, createToolContext(childId), deps)
          opsCount += (JSON.parse(raw) as { executed_ops: number }).executed_ops
          return { ok: true, sessionID: childId, textOutput: `FINAL(${await readNamedBlob(env.manager, childId, "joined")})`, messages: [] }
        },
      }
      const rootRaw = await executeRlmPlan(env.manager, { client: dummyClient, directory: "/tmp", config: BASE_CONFIG }, { operations: [
        { op: "map_rlm", variable_name: "root_chunks", prompt: "ROOT={{item}}", output_variable: "root_mapped" },
        { op: "concat", variable_name: "root_mapped", output_variable: "root_joined" },
        { op: "final_var", variable_name: "root_joined" },
      ] }, env.context, deps)
      opsCount += (JSON.parse(rootRaw) as { executed_ops: number }).executed_ops
      const output = await readNamedBlob(env.manager, env.rlmSessionId, "root_joined")
      return { opsCount, depthReached, passed: depthReached >= 2 && output.includes("leaf:DEEP="), details: { deletedSessions: env.manager.deletedSessions.length } }
    } finally {
      env.release()
    }
  },
}

export const variablePipelinePattern: BenchmarkDefinition = {
  name: "Variable Pipeline",
  async execute() {
    const env = setupBenchmark("variable-pipeline", "pipeline query")
    try {
      const planOptions = { client: dummyClient, directory: "/tmp", config: BASE_CONFIG }
      const replBackend = { execute: async (code: string, context: RlmReplContext) => code === "uppercase_context" ? (await readNamedBlob(context.manager, context.rlmSessionId, "context")).toUpperCase() : `summary:${await readNamedBlob(context.manager, context.rlmSessionId, "probe_head")}` }
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "context", content: "line-one\nline-two\nline-three" })
      const execOne = JSON.parse(await executeRlmPlan(env.manager, planOptions, { operations: [{ op: "exec", code: "uppercase_context", output_variable: "prepared" }] }, env.context, { replBackend })) as { executed_ops: number }
      const probe = createRlmProbeTool(BASE_CONFIG)
      const probed = JSON.parse(await probe.execute({ operation: "head", variable_name: "prepared", lines: 1 }, env.context)) as { content: string }
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "probe_head", content: probed.content })
      const execTwo = JSON.parse(await executeRlmPlan(env.manager, planOptions, { operations: [{ op: "exec", code: "summarize_probe", output_variable: "final_note" }] }, env.context, { replBackend })) as { executed_ops: number }
      const finish = createRlmFinishTool()
      const finalPayload = JSON.parse(await finish.execute({ variable_name: "final_note" }, env.context)) as { final_answer: string }
      return { opsCount: execOne.executed_ops + execTwo.executed_ops + 2, depthReached: 0, passed: finalPayload.final_answer === "summary:LINE-ONE", details: { finalAnswer: finalPayload.final_answer } }
    } finally {
      env.release()
    }
  },
}

export const errorRecoveryPattern: BenchmarkDefinition = {
  name: "Error Recovery",
  async execute() {
    const env = setupBenchmark("error-recovery", "recover")
    try {
      await env.manager.createBlobVariable(env.rlmSessionId, { name: "context", content: "alpha\nbeta" })
      const probe = createRlmProbeTool(BASE_CONFIG)
      const search = createRlmSearchTool()
      const invalidInput = JSON.parse(await probe.execute({ operation: "head" }, env.context)) as { code: RlmErrorCode }
      const invalidPattern = JSON.parse(await search.execute({ variable_name: "context", pattern: "", mode: "literal" }, env.context)) as { code: RlmErrorCode }
      const invalidRange = JSON.parse(await probe.execute({ operation: "slice", variable_name: "context", start: 2, end: 1 }, env.context)) as { code: RlmErrorCode }
      const codes = [invalidInput.code, invalidPattern.code, invalidRange.code]
      return { opsCount: codes.length, depthReached: 0, passed: JSON.stringify(codes) === JSON.stringify([RlmErrorCode.INVALID_INPUT, RlmErrorCode.INVALID_PATTERN, RlmErrorCode.INVALID_RANGE]), details: { codes } }
    } finally {
      env.release()
    }
  },
}

export const benchmarkPatterns = [
  splitMapReducePattern,
  recursiveDecompositionPattern,
  variablePipelinePattern,
  errorRecoveryPattern,
] satisfies BenchmarkDefinition[]
