import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import {
  _resetProviderAuthCacheForTesting,
  getProviderAuthType,
  isProviderUsingOAuth,
} from "./opencode-provider-auth"

describe("opencode-provider-auth", () => {
  let tempDataDir: string
  const originalXdgDataHome = process.env.XDG_DATA_HOME

  function writeAuthFile(contents: string): void {
    const opencodeDir = path.join(tempDataDir, "opencode", "storage")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(path.join(opencodeDir, "auth.json"), contents, "utf-8")
    _resetProviderAuthCacheForTesting()
  }

  beforeAll(() => {
    tempDataDir = path.join(tmpdir(), `opencode-provider-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDataDir, { recursive: true })
    process.env.XDG_DATA_HOME = tempDataDir
  })

  afterAll(() => {
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    rmSync(tempDataDir, { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()
  })

  afterEach(() => {
    _resetProviderAuthCacheForTesting()
  })

  it("detects OAuth providers from auth.json", () => {
    writeAuthFile(JSON.stringify({
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
      opencode: { type: "api", key: "sk-x" },
    }))

    expect(isProviderUsingOAuth("anthropic")).toBe(true)
    expect(isProviderUsingOAuth("opencode")).toBe(false)
  })

  it("returns api auth type for api-key entry", () => {
    writeAuthFile(JSON.stringify({ anthropic: { type: "api", key: "sk-ant-xxx" } }))

    expect(getProviderAuthType("anthropic")).toBe("api")
    expect(isProviderUsingOAuth("anthropic")).toBe(false)
  })

  it("returns safe defaults when auth.json is missing or malformed", () => {
    rmSync(path.join(tempDataDir, "opencode", "storage"), { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()
    expect(isProviderUsingOAuth("anthropic")).toBe(false)
    expect(getProviderAuthType("anthropic")).toBeUndefined()

    writeAuthFile("not json at all")
    expect(isProviderUsingOAuth("anthropic")).toBe(false)
  })
})
