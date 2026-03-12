import { RlmConfigSchema, ExperimentalConfigSchema, warnConfigInconsistencies } from "./experimental"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
  toThrow: () => void
  toContain: (expected: string) => void
}

type BunTestModule = {
  describe: (name: string, fn: () => void) => void
  expect: (value: unknown) => ExpectChain
  it: (name: string, fn: () => void | Promise<void>) => void
}

const bunTestSpecifier = "bun:test"
const { describe, it, expect } = (await import(bunTestSpecifier)) as BunTestModule

describe("RlmConfigSchema", () => {
  describe("valid configs", () => {
    it("accepts minimal valid config with defaults", () => {
      const result = RlmConfigSchema.parse({
        enabled: true,
        max_depth: 1,
      })
      expect(result.enabled).toBe(true)
      expect(result.max_depth).toBe(1)
      expect(result.context_storage_dir).toBe(".sisyphus/rlm-contexts")
      expect(result.distill_threshold_tokens).toBe(2000)
      expect(result.feedback).toBeUndefined()
      expect(result.probe_max_lines).toBe(200)
      expect(result.subcall_model).toBeUndefined()
    })

    it("accepts full config with all fields", () => {
      const result = RlmConfigSchema.parse({
        enabled: true,
        max_depth: 2,
        context_storage_dir: "/custom/path",
        distill_threshold_tokens: 5000,
        feedback: { output_threshold_bytes: 4096 },
        subcall_model: "claude-3-sonnet",
        probe_max_lines: 500,
      })
      expect(result.enabled).toBe(true)
      expect(result.max_depth).toBe(2)
      expect(result.context_storage_dir).toBe("/custom/path")
      expect(result.distill_threshold_tokens).toBe(5000)
      expect(result.feedback!.output_threshold_bytes).toBe(4096)
      expect(result.subcall_model).toBe("claude-3-sonnet")
      expect(result.probe_max_lines).toBe(500)
    })

    it("applies defaults when fields are omitted", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.enabled).toBe(false)
      expect(result.max_depth).toBe(1)
      expect(result.context_storage_dir).toBe(".sisyphus/rlm-contexts")
      expect(result.distill_threshold_tokens).toBe(2000)
      expect(result.feedback).toBeUndefined()
      expect(result.probe_max_lines).toBe(200)
    })

    it("accepts max_depth at boundary values", () => {
      const min = RlmConfigSchema.parse({ max_depth: 1 })
      expect(min.max_depth).toBe(1)

      const max = RlmConfigSchema.parse({ max_depth: 5 })
      expect(max.max_depth).toBe(5)
    })

    it("accepts distill_threshold_tokens at minimum", () => {
      const result = RlmConfigSchema.parse({ distill_threshold_tokens: 100 })
      expect(result.distill_threshold_tokens).toBe(100)
    })

    it("accepts probe_max_lines at minimum", () => {
      const result = RlmConfigSchema.parse({ probe_max_lines: 10 })
      expect(result.probe_max_lines).toBe(10)
    })

    it("applies default feedback threshold when feedback object is present", () => {
      const result = RlmConfigSchema.parse({ feedback: {} })
      expect(result.feedback!.output_threshold_bytes).toBe(2048)
    })
  })

  describe("invalid configs", () => {
    it("rejects max_depth=0", () => {
      expect(() => RlmConfigSchema.parse({ max_depth: 0 })).toThrow()
    })

    it("rejects max_depth > 5", () => {
      expect(() => RlmConfigSchema.parse({ max_depth: 6 })).toThrow()
    })

    it("rejects non-integer max_depth", () => {
      expect(() => RlmConfigSchema.parse({ max_depth: 1.5 })).toThrow()
    })

    it("rejects distill_threshold_tokens < 100", () => {
      expect(() => RlmConfigSchema.parse({ distill_threshold_tokens: 99 })).toThrow()
    })

    it("rejects non-integer distill_threshold_tokens", () => {
      expect(() => RlmConfigSchema.parse({ distill_threshold_tokens: 1000.5 })).toThrow()
    })

    it("rejects probe_max_lines < 10", () => {
      expect(() => RlmConfigSchema.parse({ probe_max_lines: 9 })).toThrow()
    })

    it("rejects non-integer probe_max_lines", () => {
      expect(() => RlmConfigSchema.parse({ probe_max_lines: 100.5 })).toThrow()
    })

    it("rejects feedback.output_threshold_bytes < 1", () => {
      expect(() => RlmConfigSchema.parse({ feedback: { output_threshold_bytes: 0 } })).toThrow()
    })
  })
})

describe("RlmConfigSchema - hardcoded constants promotion", () => {
  describe("probe constants", () => {
    it("accepts configurable probe_view_lines defaulting to 50", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.probe_view_lines).toBe(50)
    })

    it("accepts configurable probe_list_preview_lines defaulting to 3", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.probe_list_preview_lines).toBe(3)
    })

    it("accepts configurable probe_max_ref_preview_chars defaulting to 200", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.probe_max_ref_preview_chars).toBe(200)
    })

    it("allows overriding probe_view_lines", () => {
      const result = RlmConfigSchema.parse({ probe_view_lines: 100 })
      expect(result.probe_view_lines).toBe(100)
    })
  })

  describe("subcall constants", () => {
    it("accepts configurable subcall_timeout_ms defaulting to 60000", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.subcall_timeout_ms).toBe(60000)
    })

    it("accepts configurable subcall_poll_interval_ms defaulting to 400", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.subcall_poll_interval_ms).toBe(400)
    })

    it("allows overriding subcall_timeout_ms", () => {
      const result = RlmConfigSchema.parse({ subcall_timeout_ms: 30000 })
      expect(result.subcall_timeout_ms).toBe(30000)
    })
  })

  describe("search constants", () => {
    it("accepts configurable search_default_max_results defaulting to 20", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.search_default_max_results).toBe(20)
    })

    it("accepts configurable search_max_results defaulting to 100", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.search_max_results).toBe(100)
    })

    it("allows overriding search_max_results", () => {
      const result = RlmConfigSchema.parse({ search_max_results: 50 })
      expect(result.search_max_results).toBe(50)
    })
  })

  describe("plan constants", () => {
    it("accepts configurable plan_max_operations defaulting to 50", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.plan_max_operations).toBe(50)
    })

    it("allows overriding plan_max_operations", () => {
      const result = RlmConfigSchema.parse({ plan_max_operations: 100 })
      expect(result.plan_max_operations).toBe(100)
    })
  })

  describe("exec.print_limit_bytes independence from feedback.output_threshold_bytes", () => {
    it("exec.print_limit_bytes defaults to 2048 when exec is provided", () => {
      const result = RlmConfigSchema.parse({ exec: {} })
      expect(result.exec!.print_limit_bytes).toBe(2048)
    })

    it("feedback.output_threshold_bytes defaults to 2048 when feedback is provided", () => {
      const result = RlmConfigSchema.parse({ feedback: {} })
      expect(result.feedback!.output_threshold_bytes).toBe(2048)
    })

    it("exec.print_limit_bytes is independent - can differ from feedback.output_threshold_bytes", () => {
      const result = RlmConfigSchema.parse({
        exec: { print_limit_bytes: 4096 },
        feedback: { output_threshold_bytes: 1024 },
      })
      expect(result.exec!.print_limit_bytes).toBe(4096)
      expect(result.feedback!.output_threshold_bytes).toBe(1024)
    })
  })

  describe("session_budget and subcall_limit", () => {
    it("accepts configurable session_budget defaulting to 20", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.session_budget).toBe(20)
    })

    it("accepts configurable subcall_limit defaulting to 10", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.subcall_limit).toBe(10)
    })

    it("allows overriding session_budget", () => {
      const result = RlmConfigSchema.parse({ session_budget: 50 })
      expect(result.session_budget).toBe(50)
    })

    it("allows overriding subcall_limit", () => {
      const result = RlmConfigSchema.parse({ subcall_limit: 5 })
      expect(result.subcall_limit).toBe(5)
    })
  })

  describe("runtime warning for config inconsistencies", () => {
    it("warns when exec.print_limit_bytes > feedback.output_threshold_bytes", () => {
      const stderrWrite = console.error
      let warningLogged = false
      let warningMessage = ""
      
      const originalWrite = process.stderr.write
      process.stderr.write = ((msg: string) => {
        warningLogged = true
        warningMessage = msg
        return true
      }) as typeof process.stderr.write
      
      try {
        warnConfigInconsistencies({
          exec: { print_limit_bytes: 4096, trusted_only: true, timeout_ms: 30000 },
          feedback: { output_threshold_bytes: 2048 },
        })
        
        expect(warningLogged).toBe(true)
        expect(warningMessage).toContain("print_limit_bytes")
        expect(warningMessage).toContain("output_threshold_bytes")
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it("does not warn when exec.print_limit_bytes <= feedback.output_threshold_bytes", () => {
      const originalWrite = process.stderr.write
      let warningLogged = false

      process.stderr.write = ((() => {
        warningLogged = true
        return true
      }) as typeof process.stderr.write)
      
      try {
        // Same values - no warning
        warnConfigInconsistencies({
          exec: { print_limit_bytes: 2048, trusted_only: true, timeout_ms: 30000 },
          feedback: { output_threshold_bytes: 2048 },
        })
        
        // exec < feedback - no warning
        warnConfigInconsistencies({
          exec: { print_limit_bytes: 1024, trusted_only: true, timeout_ms: 30000 },
          feedback: { output_threshold_bytes: 2048 },
        })
        
        expect(warningLogged).toBe(false)
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it("does not warn when exec or feedback is undefined", () => {
      const originalWrite = process.stderr.write
      let warningLogged = false

      process.stderr.write = ((() => {
        warningLogged = true
        return true
      }) as typeof process.stderr.write)
      
      try {
        // No exec
        warnConfigInconsistencies({ feedback: { output_threshold_bytes: 2048 } })
        expect(warningLogged).toBe(false)
        
        warningLogged = false
        // No feedback
        warnConfigInconsistencies({ exec: { print_limit_bytes: 4096, trusted_only: true, timeout_ms: 30000 } })
        expect(warningLogged).toBe(false)
      } finally {
        process.stderr.write = originalWrite
      }
    })
  })
})

describe("RlmConfigSchema - parallel config", () => {
  describe("parallel config without fallback_chain", () => {
    it("parses parallel config with only enabled and max_concurrent", () => {
      const result = RlmConfigSchema.parse({
        parallel: {
          enabled: true,
          max_concurrent: 4,
        },
      })
      expect(result.parallel).toBeDefined()
      expect(result.parallel!.enabled).toBe(true)
      expect(result.parallel!.max_concurrent).toBe(4)
    })

    it("parallel config defaults enabled to false when omitted", () => {
      const result = RlmConfigSchema.parse({
        parallel: {},
      })
      expect(result.parallel).toBeDefined()
      expect(result.parallel!.enabled).toBe(false)
      expect(result.parallel!.max_concurrent).toBe(4)
    })

    it("parallel config is optional and can be omitted", () => {
      const result = RlmConfigSchema.parse({})
      expect(result.parallel).toBeUndefined()
    })

    it("parallel config rejects max_concurrent < 1", () => {
      expect(() =>
        RlmConfigSchema.parse({
          parallel: { max_concurrent: 0 },
        }),
      ).toThrow()
    })

    it("parallel config rejects non-integer max_concurrent", () => {
      expect(() =>
        RlmConfigSchema.parse({
          parallel: { max_concurrent: 2.5 },
        }),
      ).toThrow()
    })
  })
})

describe("ExperimentalConfigSchema with rlm field", () => {
  describe("optional nesting", () => {
    it("omitted experimental.rlm stays undefined", () => {
      const result = ExperimentalConfigSchema.parse({})
      expect(result.rlm).toBeUndefined()
    })

    it("omitted experimental.rlm in explicit experimental object stays undefined", () => {
      const result = ExperimentalConfigSchema.parse({
        aggressive_truncation: true,
      })
      expect(result.rlm).toBeUndefined()
    })

    it("defaults apply only when rlm object is present", () => {
      const result = ExperimentalConfigSchema.parse({
        rlm: {},
      })
      expect(result.rlm).toBeDefined()
      expect(result.rlm!.enabled).toBe(false)
      expect(result.rlm!.max_depth).toBe(1)
      expect(result.rlm!.context_storage_dir).toBe(".sisyphus/rlm-contexts")
      expect(result.rlm!.distill_threshold_tokens).toBe(2000)
      expect(result.rlm!.feedback).toBeUndefined()
      expect(result.rlm!.probe_max_lines).toBe(200)
    })

    it("rlm config can coexist with other experimental fields", () => {
      const result = ExperimentalConfigSchema.parse({
        aggressive_truncation: true,
        rlm: {
          enabled: true,
          max_depth: 2,
        },
      })
      expect(result.aggressive_truncation).toBe(true)
      expect(result.rlm).toBeDefined()
      expect(result.rlm!.enabled).toBe(true)
      expect(result.rlm!.max_depth).toBe(2)
    })
  })

  describe("rlm field validation", () => {
    it("rejects invalid rlm config", () => {
      expect(() =>
        ExperimentalConfigSchema.parse({
          rlm: {
            max_depth: 0,
          },
        }),
      ).toThrow()
    })

    it("accepts valid rlm config with all fields", () => {
      const result = ExperimentalConfigSchema.parse({
        rlm: {
          enabled: true,
          max_depth: 3,
          context_storage_dir: "/tmp/rlm",
          distill_threshold_tokens: 3000,
          feedback: { output_threshold_bytes: 8192 },
          subcall_model: "claude-3-opus",
          probe_max_lines: 300,
        },
      })
      expect(result.rlm).toBeDefined()
      expect(result.rlm!.enabled).toBe(true)
      expect(result.rlm!.max_depth).toBe(3)
      expect(result.rlm!.feedback!.output_threshold_bytes).toBe(8192)
      expect(result.rlm!.subcall_model).toBe("claude-3-opus")
    })
  })
})
