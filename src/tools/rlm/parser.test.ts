import { describe, expect, it } from "bun:test"
import { parseFinalAnswer, isParsedFinalSuccess } from "./parser"

describe("parseFinalAnswer", () => {
  describe("#given valid FINAL tag", () => {
    it("parses FINAL(value) with simple content", () => {
      const result = parseFinalAnswer("FINAL(the answer is 42)")
      expect(result).toEqual({ type: "final", content: "the answer is 42" })
    })

    it("parses FINAL embedded in larger text", () => {
      const result = parseFinalAnswer("Here is my analysis:\nFINAL(summary of findings)")
      expect(result).toEqual({ type: "final", content: "summary of findings" })
    })

    it("parses FINAL with empty content", () => {
      const result = parseFinalAnswer("FINAL()")
      expect(result).toEqual({ type: "final", content: "" })
    })
  })

  describe("#given valid FINAL_VAR tag", () => {
    it("parses FINAL_VAR(varName)", () => {
      const result = parseFinalAnswer("FINAL_VAR(final_summary)")
      expect(result).toEqual({ type: "final_var", variableName: "final_summary" })
    })

    it("parses FINAL_VAR embedded in larger text", () => {
      const result = parseFinalAnswer("Done processing.\nFINAL_VAR(result)")
      expect(result).toEqual({ type: "final_var", variableName: "result" })
    })

    it("trims whitespace from variable name", () => {
      const result = parseFinalAnswer("FINAL_VAR( myVar )")
      expect(result).toEqual({ type: "final_var", variableName: "myVar" })
    })
  })

  describe("#given malformed tags", () => {
    it("returns error for FINAL( without closing paren", () => {
      const result = parseFinalAnswer("FINAL(unclosed content")
      expect(result).not.toBeNull()
      expect(result?.type).toBe("error")
      if (result?.type === "error") {
        expect(result.message).toContain("missing closing parenthesis")
      }
    })

    it("returns error for FINAL_VAR( without closing paren", () => {
      const result = parseFinalAnswer("FINAL_VAR(unclosed")
      expect(result).not.toBeNull()
      expect(result?.type).toBe("error")
      if (result?.type === "error") {
        expect(result.message).toContain("missing closing parenthesis")
      }
    })

    it("returns error for FINAL_VAR() with empty name", () => {
      const result = parseFinalAnswer("FINAL_VAR()")
      expect(result).not.toBeNull()
      expect(result?.type).toBe("error")
      if (result?.type === "error") {
        expect(result.message).toContain("empty variable name")
      }
    })

    it("returns error for FINAL_VAR with only whitespace name", () => {
      const result = parseFinalAnswer("FINAL_VAR(   )")
      expect(result).not.toBeNull()
      expect(result?.type).toBe("error")
      if (result?.type === "error") {
        expect(result.message).toContain("empty variable name")
      }
    })
  })

  describe("#given no FINAL tags", () => {
    it("returns null for plain text", () => {
      expect(parseFinalAnswer("just some regular text")).toBeNull()
    })

    it("returns null for empty string", () => {
      expect(parseFinalAnswer("")).toBeNull()
    })

    it("returns null for partial keyword without parens", () => {
      expect(parseFinalAnswer("FINAL without parens")).toBeNull()
    })
  })

  describe("#given FINAL_VAR takes priority over FINAL", () => {
    it("matches FINAL_VAR when both patterns exist", () => {
      const result = parseFinalAnswer("FINAL_VAR(myVar) and also FINAL(something)")
      expect(result).toEqual({ type: "final_var", variableName: "myVar" })
    })
  })
})

describe("isParsedFinalSuccess", () => {
  it("returns true for final type", () => {
    expect(isParsedFinalSuccess({ type: "final", content: "x" })).toBe(true)
  })

  it("returns true for final_var type", () => {
    expect(isParsedFinalSuccess({ type: "final_var", variableName: "x" })).toBe(true)
  })

  it("returns false for error type", () => {
    expect(isParsedFinalSuccess({ type: "error", message: "bad", raw: "" })).toBe(false)
  })
})
