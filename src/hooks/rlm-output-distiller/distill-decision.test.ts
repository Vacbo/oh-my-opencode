import { describe, it, expect } from "bun:test"
import { estimateTokens, shouldDistillOutput, distillOutput } from "./distill-decision"

describe("distill-decision", () => {
  describe("estimateTokens", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokens(0)).toBe(0)
    })

    it("uses chars/4 approximation", () => {
      expect(estimateTokens(400)).toBe(100)
    })

    it("rounds up for non-divisible lengths", () => {
      expect(estimateTokens(401)).toBe(101)
      expect(estimateTokens(3)).toBe(1)
    })
  })

  describe("shouldDistillOutput", () => {
    describe("#given sessionShouldDistill is true", () => {
      it("#then returns true regardless of output size", () => {
        expect(
          shouldDistillOutput({
            outputCharCount: 1,
            thresholdTokens: 2000,
            sessionShouldDistill: true,
          }),
        ).toBe(true)
      })
    })

    describe("#given sessionShouldDistill is false", () => {
      describe("#when output exceeds threshold", () => {
        it("#then returns true", () => {
          // 8001 chars = 2001 tokens > 2000 threshold
          expect(
            shouldDistillOutput({
              outputCharCount: 8001,
              thresholdTokens: 2000,
              sessionShouldDistill: false,
            }),
          ).toBe(true)
        })
      })

      describe("#when output is within threshold", () => {
        it("#then returns false", () => {
          // 8000 chars = 2000 tokens = threshold (not exceeded)
          expect(
            shouldDistillOutput({
              outputCharCount: 8000,
              thresholdTokens: 2000,
              sessionShouldDistill: false,
            }),
          ).toBe(false)
        })
      })

      describe("#when output is well under threshold", () => {
        it("#then returns false", () => {
          expect(
            shouldDistillOutput({
              outputCharCount: 100,
              thresholdTokens: 2000,
              sessionShouldDistill: false,
            }),
          ).toBe(false)
        })
      })
    })
  })

  describe("distillOutput", () => {
    it("truncates output and appends summary marker", () => {
      const longOutput = "x".repeat(12000)
      const result = distillOutput(longOutput, 2000)

      expect(result.startsWith("x".repeat(8000))).toBe(true)
      expect(result).toContain("[RLM distiller:")
      expect(result).toContain("truncated from ~3000 to ~2000 tokens")
    })

    it("preserves output that fits within threshold chars", () => {
      const shortOutput = "hello world"
      const result = distillOutput(shortOutput, 2000)

      expect(result).toContain("hello world")
      expect(result).toContain("[RLM distiller:")
    })
  })
})
