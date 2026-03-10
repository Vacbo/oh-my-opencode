import { RlmConfigSchema, ExperimentalConfigSchema } from "./experimental"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toBeDefined: () => void
  toBeUndefined: () => void
  toThrow: () => void
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
