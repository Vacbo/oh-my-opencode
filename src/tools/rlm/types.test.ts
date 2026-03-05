import { describe, expect, it } from "bun:test"
import {
  RlmProbeInputSchema,
  RlmSearchInputSchema,
  RlmPlanInputSchema,
  RlmFinishInputSchema,
  InitRlmSessionInputSchema,
} from "./types"

describe("RlmProbeInputSchema", () => {
  describe("#given discriminated union by operation", () => {
    it("#when head operation #then accepts variable_name and optional lines", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "head",
        variable_name: "context",
        lines: 50,
      })

      expect(result.success).toBe(true)
    })

    it("#when tail operation #then accepts variable_name and optional lines", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "tail",
        variable_name: "context",
      })

      expect(result.success).toBe(true)
    })

    it("#when slice operation #then requires start and end", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "slice",
        variable_name: "context",
        start: 10,
        end: 20,
      })

      expect(result.success).toBe(true)
    })

    it("#when slice without start #then rejects", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "slice",
        variable_name: "context",
        end: 20,
      })

      expect(result.success).toBe(false)
    })

    it("#when stats operation #then accepts variable_name only", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "stats",
        variable_name: "context",
      })

      expect(result.success).toBe(true)
    })

    it("#when schema operation #then accepts variable_name only", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "schema",
        variable_name: "context",
      })

      expect(result.success).toBe(true)
    })

    it("#when list_vars operation #then omits variable_name", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "list_vars",
      })

      expect(result.success).toBe(true)
    })

    it("#when unknown operation #then rejects", () => {
      const result = RlmProbeInputSchema.safeParse({
        operation: "unknown_op",
        variable_name: "context",
      })

      expect(result.success).toBe(false)
    })
  })
})

describe("RlmSearchInputSchema", () => {
  it("#when valid input #then parses with mode default", () => {
    const result = RlmSearchInputSchema.safeParse({
      variable_name: "context",
      pattern: "function.*handler",
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe("literal")
    }
  })

  it("#when regex mode #then accepts", () => {
    const result = RlmSearchInputSchema.safeParse({
      variable_name: "context",
      pattern: "^import",
      mode: "regex",
      max_results: 10,
    })

    expect(result.success).toBe(true)
  })
})

describe("RlmPlanInputSchema", () => {
  describe("#given 8-op discriminated union", () => {
    it("#when all 8 operations provided #then parses valid plan", () => {
      const result = RlmPlanInputSchema.safeParse({
        operations: [
          { op: "split", variable_name: "context", chunk_size: 1000, output_variable: "chunks" },
          { op: "select", variable_name: "chunks", indices: [0, 2], output_variable: "selected" },
          { op: "map_llm", variable_name: "selected", prompt: "Summarize: {{item}}", output_variable: "summaries" },
          { op: "map_rlm", variable_name: "selected", prompt: "Analyze: {{item}}", output_variable: "analyses" },
          { op: "concat", variable_name: "summaries", output_variable: "combined" },
          { op: "reduce_llm", variable_name: "analyses", prompt: "Merge: {{item}}", output_variable: "reduced" },
          { op: "write_var", variable_name: "note", content: "done" },
          { op: "final_var", variable_name: "reduced" },
        ],
      })

      expect(result.success).toBe(true)
    })

    it("#when empty operations #then rejects", () => {
      const result = RlmPlanInputSchema.safeParse({ operations: [] })

      expect(result.success).toBe(false)
    })

    it("#when unknown op #then rejects", () => {
      const result = RlmPlanInputSchema.safeParse({
        operations: [{ op: "invalid", variable_name: "x" }],
      })

      expect(result.success).toBe(false)
    })
  })
})

describe("RlmFinishInputSchema", () => {
  it("#when only variable_name provided #then accepts", () => {
    const result = RlmFinishInputSchema.safeParse({ variable_name: "result" })

    expect(result.success).toBe(true)
  })

  it("#when only value provided #then accepts", () => {
    const result = RlmFinishInputSchema.safeParse({ value: "The answer is 42" })

    expect(result.success).toBe(true)
  })

  it("#when both variable_name and value provided #then rejects", () => {
    const result = RlmFinishInputSchema.safeParse({
      variable_name: "result",
      value: "literal",
    })

    expect(result.success).toBe(false)
  })

  it("#when neither variable_name nor value provided #then rejects", () => {
    const result = RlmFinishInputSchema.safeParse({})

    expect(result.success).toBe(false)
  })
})

describe("InitRlmSessionInputSchema", () => {
  const validBase = {
    sessionId: "ses-1",
    query: "summarize the file",
    maxDepth: 2,
    contextDir: "/tmp/rlm",
  }

  describe("#given XOR validation for content vs file_path", () => {
    it("#when only content provided #then accepts", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        ...validBase,
        content: "file contents here",
      })

      expect(result.success).toBe(true)
    })

    it("#when only file_path provided #then accepts", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        ...validBase,
        file_path: "/path/to/file.txt",
      })

      expect(result.success).toBe(true)
    })

    it("#when both content and file_path provided #then rejects", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        ...validBase,
        content: "inline",
        file_path: "/path/to/file.txt",
      })

      expect(result.success).toBe(false)
    })

    it("#when neither content nor file_path provided #then rejects", () => {
      const result = InitRlmSessionInputSchema.safeParse(validBase)

      expect(result.success).toBe(false)
    })
  })

  describe("#given query is required", () => {
    it("#when query is missing #then rejects", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        sessionId: "ses-1",
        content: "data",
        maxDepth: 2,
        contextDir: "/tmp",
      })

      expect(result.success).toBe(false)
    })
  })

  describe("#given shouldDistill default", () => {
    it("#when shouldDistill omitted #then defaults to false", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        ...validBase,
        content: "data",
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.shouldDistill).toBe(false)
      }
    })

    it("#when shouldDistill explicitly true #then preserves", () => {
      const result = InitRlmSessionInputSchema.safeParse({
        ...validBase,
        content: "data",
        shouldDistill: true,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.shouldDistill).toBe(true)
      }
    })
  })
})
