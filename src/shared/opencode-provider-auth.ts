import * as fs from "node:fs"
import * as path from "node:path"
import { getOpenCodeStorageDir } from "./data-path"

type AuthFile = Record<string, { type?: unknown }>

let cachedAuth: AuthFile | null | undefined

function getAuthPath(): string {
  return path.join(getOpenCodeStorageDir(), "auth.json")
}

function loadAuth(): AuthFile | null {
  if (cachedAuth !== undefined) return cachedAuth
  try {
    const raw = fs.readFileSync(getAuthPath(), "utf-8")
    const parsed = JSON.parse(raw)
    cachedAuth = typeof parsed === "object" && parsed !== null ? parsed as AuthFile : null
  } catch {
    cachedAuth = null
  }
  return cachedAuth
}

export function getProviderAuthType(providerID: string): string | undefined {
  const auth = loadAuth()
  const entry = auth?.[providerID]
  return typeof entry?.type === "string" ? entry.type : undefined
}

export function isProviderUsingOAuth(providerID: string): boolean {
  return getProviderAuthType(providerID) === "oauth"
}

export function _resetProviderAuthCacheForTesting(): void {
  cachedAuth = undefined
}
