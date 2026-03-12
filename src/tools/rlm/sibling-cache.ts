import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { RlmConfig } from "../../config/schema/experimental"

export const DEFAULT_SIBLING_CACHE_DIR = ".sisyphus/rlm-cache/siblings"

type SiblingCacheConfig = NonNullable<RlmConfig["cache"]>

type SiblingCacheEntry = {
  created_at: number
  result: string
}

export type SiblingCacheKeyParts = {
  session_id: string
  root_query: string
  model: string
  provider: string
  version: string
  temperature: string
  system_prompt_hash: string
}

export type SiblingCacheLookupInput = {
  cache?: Partial<SiblingCacheConfig>
  cacheDir?: string
  sessionId: string
  rootQuery: string
  model?: string
  provider?: string
  version?: string
  temperature?: number
  systemPrompt: string
  now?: () => number
}

function hashValue(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function toTemperatureKey(temperature: number | undefined): string {
  return temperature === undefined ? "default" : String(temperature)
}

function isSiblingCacheEntry(value: unknown): value is SiblingCacheEntry {
  return !!value
    && typeof value === "object"
    && typeof (value as SiblingCacheEntry).created_at === "number"
    && typeof (value as SiblingCacheEntry).result === "string"
}

function isExpired(entry: SiblingCacheEntry, ttlHours: number, now: number): boolean {
  return entry.created_at + ttlHours * 60 * 60 * 1000 <= now
}

function hasCompleteCacheFingerprint(input: SiblingCacheLookupInput): boolean {
  return !!input.model && !!input.provider && input.temperature !== undefined && input.systemPrompt.length > 0
}

export function createSiblingCacheKey(input: Omit<SiblingCacheLookupInput, "cache" | "cacheDir" | "now">): {
  parts: SiblingCacheKeyParts
  cacheKey: string
  cacheFileName: string
} {
  const parts: SiblingCacheKeyParts = {
    session_id: input.sessionId,
    root_query: input.rootQuery,
    model: input.model ?? "default-model",
    provider: input.provider ?? "default-provider",
    version: input.version ?? "default-version",
    temperature: toTemperatureKey(input.temperature),
    system_prompt_hash: hashValue(input.systemPrompt),
  }
  const cacheKey = JSON.stringify(parts)
  return {
    parts,
    cacheKey,
    cacheFileName: `${hashValue(cacheKey)}.json`,
  }
}

export function resolveSiblingCacheFilePath(cacheDir: string, cacheFileName: string): string {
  return join(cacheDir, cacheFileName)
}

export async function lookupSiblingCacheResult(input: SiblingCacheLookupInput): Promise<string | null> {
  if (input.cache?.enabled === false || !hasCompleteCacheFingerprint(input)) {
    return null
  }

  const ttlHours = input.cache?.ttl_hours ?? 24
  const cacheDir = input.cacheDir ?? DEFAULT_SIBLING_CACHE_DIR
  const filePath = resolveSiblingCacheFilePath(cacheDir, createSiblingCacheKey(input).cacheFileName)

  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isSiblingCacheEntry(parsed)) {
    return null
  }

  const now = input.now?.() ?? Date.now()
  if (isExpired(parsed, ttlHours, now)) {
    return null
  }

  return parsed.result
}
