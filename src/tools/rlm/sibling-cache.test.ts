import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RlmConfigSchema } from "../../config/schema/experimental"
import { executeRlmPlan } from "./plan-executor"
import {
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  InMemoryRlmManager,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import {
  createSiblingCacheKey,
  lookupSiblingCacheResult,
  resolveSiblingCacheFilePath,
} from "./sibling-cache"
import { buildRlmSystemPrompt } from "./system-prompt"

const SESSION_ID = "ses-sibling-cache"
const RLM_SESSION_ID = testRlmSessionId(SESSION_ID)

const tempDirs: string[] = []

afterEach(async () => {
  unbindTestCoordinator(SESSION_ID)
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

async function createTempCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omo-rlm-sibling-cache-"))
  tempDirs.push(dir)
  return dir
}

function createSystemPrompt(): string {
  return buildRlmSystemPrompt({
    depth: 0,
    maxDepth: 3,
    contextMetadata: { contextVariableName: "context" },
    mode: "canonical",
  })
}

describe("sibling-cache", () => {
  it("builds distinct keys for model fingerprint changes and hashes system prompts", () => {
    const base = createSiblingCacheKey({
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      version: "2026-03-01",
      temperature: 0.1,
      systemPrompt: createSystemPrompt(),
    })
    const changed = createSiblingCacheKey({
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "claude-opus-4-6",
      provider: "anthropic",
      version: "2026-03-02",
      temperature: 0.2,
      systemPrompt: `${createSystemPrompt()} changed`,
    })

    expect(base.parts.session_id).toBe(RLM_SESSION_ID)
    expect(base.parts.root_query).toBe("root query")
    expect(base.parts.system_prompt_hash).toHaveLength(64)
    expect(base.cacheFileName).not.toBe(changed.cacheFileName)
    expect(base.parts.system_prompt_hash).not.toBe(changed.parts.system_prompt_hash)
  })

  it("returns cached results when enabled and fresh", async () => {
    const cacheDir = await createTempCacheDir()
    const key = createSiblingCacheKey({
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      version: "2026-03-01",
      temperature: 0.1,
      systemPrompt: createSystemPrompt(),
    })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      resolveSiblingCacheFilePath(cacheDir, key.cacheFileName),
      JSON.stringify({ created_at: Date.now(), result: '{"cached":true}' }),
      "utf8",
    )

    const result = await lookupSiblingCacheResult({
      cacheDir,
      cache: { enabled: true, ttl_hours: 24 },
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      version: "2026-03-01",
      temperature: 0.1,
      systemPrompt: createSystemPrompt(),
    })

    expect(result).toBe('{"cached":true}')
  })

  it("ignores disabled or expired cache entries", async () => {
    const cacheDir = await createTempCacheDir()
    const key = createSiblingCacheKey({
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      systemPrompt: createSystemPrompt(),
    })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      resolveSiblingCacheFilePath(cacheDir, key.cacheFileName),
      JSON.stringify({ created_at: Date.now() - 25 * 60 * 60 * 1000, result: '{"stale":true}' }),
      "utf8",
    )

    const expired = await lookupSiblingCacheResult({
      cacheDir,
      cache: { enabled: true, ttl_hours: 24 },
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      systemPrompt: createSystemPrompt(),
    })
    const disabled = await lookupSiblingCacheResult({
      cacheDir,
      cache: { enabled: false, ttl_hours: 24 },
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      systemPrompt: createSystemPrompt(),
    })

    expect(expired).toBeNull()
    expect(disabled).toBeNull()
  })

  it("short-circuits plan execution on a sibling cache hit", async () => {
    const cacheDir = await createTempCacheDir()
    const config = RlmConfigSchema.parse({ enabled: true, max_depth: 3, cache: { enabled: true, ttl_hours: 24 } })
    const manager = new InMemoryRlmManager()
    manager.seedSession(createSession(RLM_SESSION_ID, "root query", "task prompt", 0, 3))
    bindTestCoordinator(SESSION_ID, manager, { rlmSessionId: RLM_SESSION_ID, rootQuery: "root query", taskPrompt: "task prompt" })

    const cachedResult = JSON.stringify({ terminal: false, halted: false, executed_ops: 99, operation_results: [{ op: "cached" }] })
    const key = createSiblingCacheKey({
      sessionId: RLM_SESSION_ID,
      rootQuery: "root query",
      model: "gpt-5.3-codex",
      provider: "openai",
      version: "2026-03-01",
      temperature: 0.1,
      systemPrompt: createSystemPrompt(),
    })
    await writeFile(
      resolveSiblingCacheFilePath(cacheDir, key.cacheFileName),
      JSON.stringify({ created_at: Date.now(), result: cachedResult }),
      "utf8",
    )

    const result = await executeRlmPlan(
      manager,
      {
        client: dummyClient,
        directory: "/tmp",
        config,
        subcallModel: { providerID: "openai", modelID: "gpt-5.3-codex" },
        siblingCache: { cacheDir, version: "2026-03-01", temperature: 0.1 },
      },
      { operations: [{ op: "write_var", variable_name: "fresh", content: "miss" }] },
      createToolContext(SESSION_ID),
    )

    expect(result).toBe(cachedResult)
    expect(manager.getVariableByName(RLM_SESSION_ID, "fresh")).toBeUndefined()
  })

  it("adds cache defaults to RLM config", () => {
    const config = RlmConfigSchema.parse({})
    expect(config.cache?.enabled).toBe(true)
    expect(config.cache?.ttl_hours).toBe(24)
  })
})
