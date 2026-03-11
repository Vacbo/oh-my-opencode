import { describe, it, expect } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { createToolRegistry } from "./tool-registry"
import type { PluginContext } from "./types"

describe("RLM Tool Registration", () => {
  it("should register four public RLM tools when enabled", () => {
    const mockCtx: PluginContext = {
      directory: "/tmp/test",
      client: {} as any,
    }

    const pluginConfig: OhMyOpenCodeConfig = {
      experimental: {
        rlm: {
          enabled: true,
          max_depth: 1,
          context_storage_dir: ".sisyphus/rlm-contexts",
          distill_threshold_tokens: 2000,
          probe_max_lines: 200,
        },
      },
    } as any

    const managers = {
      backgroundManager: {} as any,
      tmuxSessionManager: {} as any,
      skillMcpManager: {} as any,
    }

    const skillContext = {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: {} as any,
      disabledSkills: new Set(),
    }

    const result = createToolRegistry({
      ctx: mockCtx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories: [],
    })

    const rlmTools = Object.keys(result.filteredTools).filter(k => k.startsWith("rlm_"))
    expect(rlmTools).toContain("rlm_probe")
    expect(rlmTools).toContain("rlm_search")
    expect(rlmTools).toContain("rlm_plan")
    expect(rlmTools).toContain("rlm_finish")
    expect(rlmTools.length).toBe(4)
    
    // Ensure no internal init surface
    expect(rlmTools).not.toContain("rlm_init")
    expect(rlmTools).not.toContain("initRlmSession")
  })

  it("should not register RLM tools when disabled", () => {
    const mockCtx: PluginContext = {
      directory: "/tmp/test",
      client: {} as any,
    }

    const pluginConfig: OhMyOpenCodeConfig = {
      experimental: {
        rlm: {
          enabled: false,
          max_depth: 1,
          context_storage_dir: ".sisyphus/rlm-contexts",
          distill_threshold_tokens: 2000,
          probe_max_lines: 200,
        },
      },
    } as any

    const managers = {
      backgroundManager: {} as any,
      tmuxSessionManager: {} as any,
      skillMcpManager: {} as any,
    }

    const skillContext = {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: {} as any,
      disabledSkills: new Set(),
    }

    const result = createToolRegistry({
      ctx: mockCtx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories: [],
    })

    const rlmTools = Object.keys(result.filteredTools).filter(k => k.startsWith("rlm_"))
    expect(rlmTools.length).toBe(0)
  })

  it("should not register RLM tools when rlm config is absent", () => {
    const mockCtx: PluginContext = {
      directory: "/tmp/test",
      client: {} as any,
    }

    const pluginConfig: OhMyOpenCodeConfig = {} as any

    const managers = {
      backgroundManager: {} as any,
      tmuxSessionManager: {} as any,
      skillMcpManager: {} as any,
    }

    const skillContext = {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: {} as any,
      disabledSkills: new Set(),
    }

    const result = createToolRegistry({
      ctx: mockCtx,
      pluginConfig,
      managers,
      skillContext,
      availableCategories: [],
    })

    const rlmTools = Object.keys(result.filteredTools).filter(k => k.startsWith("rlm_"))
    expect(rlmTools.length).toBe(0)
  })
})
