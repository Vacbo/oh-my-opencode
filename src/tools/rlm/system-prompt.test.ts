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

      it("shows async signatures for getVar and setVar", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("(name: string) => Promise<string>")
        expect(prompt).toContain("(name: string, value: string) => Promise<void>")
        expect(prompt).toContain("async context")
        expect(prompt).toContain("await")
      })

      it("lists exec as the 9th operation", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("Operations (9 total)")
        expect(prompt).toContain("`exec`")
        expect(prompt).toContain("Execute JavaScript code")
      })

      it("describes exec operation with all available globals", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("exec")
        expect(prompt).toContain("getVar")
        expect(prompt).toContain("setVar")
        expect(prompt).toContain("llm_query")
        expect(prompt).toContain("print")
        expect(prompt).toContain("getQuery")
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

  describe("#given strategy guidance section", () => {
    describe("#then canonical mode includes strategy guidance", () => {
      it("contains a Strategy Guidance section header", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("## Strategy Guidance")
      })

      it("places strategy section after Workflow Example", () => {
        const prompt = getCanonicalPrompt()
        const workflowIdx = prompt.indexOf("## Workflow Example")
        const strategyIdx = prompt.indexOf("## Strategy Guidance")
        const principlesIdx = prompt.indexOf("## Key Principles")
        expect(workflowIdx).toBeGreaterThan(-1)
        expect(strategyIdx).toBeGreaterThan(workflowIdx)
        expect(principlesIdx).toBeGreaterThan(strategyIdx)
      })

      it("describes 4 strategies: Peeking, Grepping, Partition+Map, Summarization", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toContain("Peeking")
        expect(prompt).toContain("Grepping")
        expect(prompt).toContain("Partition+Map")
        expect(prompt).toContain("Summarization")
      })
    })

    describe("#then each strategy card has required fields", () => {
      it("Peeking has trigger, operations, and anti-pattern", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toMatch(/Peeking[\s\S]*?When to use/i)
        expect(prompt).toMatch(/Peeking[\s\S]*?head|tail|slice|stats/i)
        expect(prompt).toMatch(/Peeking[\s\S]*?not/i)
      })

      it("Grepping has trigger, operations, and anti-pattern", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toMatch(/Grepping[\s\S]*?When to use/i)
        expect(prompt).toMatch(/Grepping[\s\S]*?rlm_search/i)
        expect(prompt).toMatch(/Grepping[\s\S]*?not/i)
      })

      it("Partition+Map has trigger, operations, and anti-pattern", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toMatch(/Partition\+Map[\s\S]*?When to use/i)
        expect(prompt).toMatch(/Partition\+Map[\s\S]*?split[\s\S]*?map/i)
        expect(prompt).toMatch(/Partition\+Map[\s\S]*?not/i)
      })

      it("Summarization has trigger, operations, and anti-pattern", () => {
        const prompt = getCanonicalPrompt()
        expect(prompt).toMatch(/Summarization[\s\S]*?When to use/i)
        expect(prompt).toMatch(/Summarization[\s\S]*?reduce_llm|map_llm/i)
        expect(prompt).toMatch(/Summarization[\s\S]*?not/i)
      })
    })

    describe("#then strategy section respects token budget", () => {
      it("strategy section is under 3200 characters (~800 tokens)", () => {
        const prompt = getCanonicalPrompt()
        const strategyStart = prompt.indexOf("## Strategy Guidance")
        const strategyEnd = prompt.indexOf("## Key Principles")
        expect(strategyStart).toBeGreaterThan(-1)
        expect(strategyEnd).toBeGreaterThan(strategyStart)
        const strategySection = prompt.slice(strategyStart, strategyEnd)
        expect(strategySection.length).toBeLessThanOrEqual(3200)
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

    it("does NOT include strategy guidance section", () => {
      const prompt = buildRlmSystemPrompt({
        ...defaultOptions,
        mode: "keyword-alias",
      })
      expect(prompt).not.toContain("Strategy Guidance")
      expect(prompt).not.toContain("Peeking")
      expect(prompt).not.toContain("Partition+Map")
    })
  })
})
