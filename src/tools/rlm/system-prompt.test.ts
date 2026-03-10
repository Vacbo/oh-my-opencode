import { describe, expect, it } from "bun:test"
import { buildRlmSystemPrompt } from "./system-prompt"

describe("buildRlmSystemPrompt", () => {
  const defaultOptions = {
    depth: 0,
    maxDepth: 3,
    contextMetadata: {
      contextVariableName: "context",
      contextSize: 1024,
      contextType: "content",
    },
    mode: "canonical" as const,
  }

  function getCanonicalPrompt(overrides?: Partial<typeof defaultOptions>): string {
    return buildRlmSystemPrompt({ ...defaultOptions, ...overrides })
  }

  describe("#given canonical mode", () => {
    describe("#then prompt contains Appendix C invariants", () => {
      it("contains 'context' as the primary variable name", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("`context`")
        expect(prompt).toContain("real binding")
        expect(prompt).toContain("injected into your REPL namespace")
      })

      it("contains 'llm_query' as a callable LM function", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("llm_query")
        expect(prompt).toContain("(prompt: string")
        expect(prompt).toContain("Promise<string>")
        expect(prompt).toContain("Call a language model")
      })

      it("contains 'print' with bounded/truncation note", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("print(value)")
        expect(prompt).toContain("truncated")
        expect(prompt).toContain("bounded")
      })

      it("contains batching/chunking guidance", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("chunk-then-query")
        expect(prompt).toMatch(/split.*map.*reduce/is)
        expect(prompt).toContain("batch")
      })

      it("contains FINAL and FINAL_VAR finalization mechanisms", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("FINAL(")
        expect(prompt).toContain("FINAL_VAR(")
        expect(prompt).toContain("ends the session")
      })

      it("describes JavaScript exec syntax with all 5 globals", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("JavaScript")
        expect(prompt).toContain("getVar(name)")
        expect(prompt).toContain("setVar(name, value)")
        expect(prompt).toContain("llm_query(prompt, options?)")
        expect(prompt).toContain("print(value)")
        expect(prompt).toContain("getQuery()")
      })
    })

    describe("#when custom context variable name is used", () => {
      it("uses the custom variable name throughout", () => {
        const prompt = getCanonicalPrompt({
          contextMetadata: {
            contextVariableName: "sourceCode",
            contextSize: 2048,
            contextType: "file_path",
          },
        })
        expect(prompt).toContain("`sourceCode`")
        expect(prompt).toContain('getVar("sourceCode")')
      })
    })

    describe("#when printLimitBytes is configured", () => {
      it("reflects the configured limit in the prompt", () => {
        const prompt = getCanonicalPrompt({ printLimitBytes: 4096 })
        expect(prompt).toContain("4 KB")
      })

      it("uses bytes format for small limits", () => {
        const prompt = getCanonicalPrompt({ printLimitBytes: 512 })
        expect(prompt).toContain("512 bytes")
      })
    })

    describe("#when at max depth", () => {
      it("indicates recursion is not available", () => {
        const prompt = getCanonicalPrompt({ depth: 2, maxDepth: 3 })
        expect(prompt).toContain("cannot request recursive child RLM sessions")
      })
    })

    describe("#when can recurse", () => {
      it("indicates recursion is available", () => {
        const prompt = getCanonicalPrompt({ depth: 0, maxDepth: 3 })
        expect(prompt).toContain("can request recursive child RLM sessions")
      })
    })
  })

  describe("#given keyword-alias mode", () => {
    it("returns a lightweight prompt", () => {
      const prompt = buildRlmSystemPrompt({
        ...defaultOptions,
        mode: "keyword-alias",
      })
      expect(prompt).toContain("Lightweight")
      expect(prompt).toContain("context")
      expect(prompt).not.toContain("Execution Environment")
    })
  })
})
