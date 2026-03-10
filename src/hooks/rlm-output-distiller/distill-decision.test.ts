import { coordinator } from "../../features/rlm-context/coordinator"
import { estimateTokens, shouldDistillOutput, distillOutput } from "./distill-decision"

type ExpectChain = {
  toBe: (expected: unknown) => void
  toContain: (expected: unknown) => void
}

type BunTestModule = {
  afterEach: (fn: () => void) => void
  describe: (name: string, fn: () => void) => void
  expect: (value: unknown) => ExpectChain
  it: (name: string, fn: () => void | Promise<void>) => void
}

const bunTestSpecifier = "bun:test"
const { afterEach, describe, it, expect } = (await import(bunTestSpecifier)) as BunTestModule

const SESSION_ID = "ses-distill-rlm"

describe("distill-decision", () => {
  afterEach(() => {
    coordinator.unbind(SESSION_ID)
  })

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
      describe("#when session has an active RLM binding", () => {
        it("#then returns false so turn-feedback can offload instead", () => {
          coordinator.bind(SESSION_ID, {
            manager: {
              getVariableByName: async () => undefined,
              readBlobContent: async () => "",
              readManifest: async () => [],
              listVariables: async () => [],
              initSession: async () => ({ sessionId: SESSION_ID, depth: 0, maxDepth: 1, contextDir: ".", query: "", shouldDistill: false, variables: new Map() }),
              getSession: async () => undefined,
              createBlobVariable: async () => ({ sessionId: SESSION_ID, name: "x", storageKind: "blob", semanticType: "scratch", createdAt: 0, filePath: "x", byteSize: 0, source: "content", lineCount: 0 }),
              createManifestVariable: async () => ({ sessionId: SESSION_ID, name: "m", storageKind: "manifest", semanticType: "derived", createdAt: 0, filePath: "m", byteSize: 0, itemCount: 0 }),
              resolveManifestItems: async () => [],
              deleteSession: async () => {},
            },
            rlmSessionId: SESSION_ID,
            depth: 0,
            query: "test",
            contextVariableName: "context",
            trusted: true,
          })

          expect(
            shouldDistillOutput({
              outputCharCount: 8001,
              thresholdTokens: 2000,
              sessionShouldDistill: false,
              sessionID: SESSION_ID,
            }),
          ).toBe(false)
        })
      })

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
