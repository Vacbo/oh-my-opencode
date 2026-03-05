import { describe, expect, it } from "bun:test"
import { parseFinalAnswer } from "./parser"

describe("parseFinalAnswer", () => {
  describe("#given FINAL_VAR and FINAL both present", () => {
    it("#when parsing #then FINAL_VAR takes precedence", () => {
      const text = "FINAL(plain answer)\nFINAL_VAR(result_var)"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toEqual({
        type: "final_var",
        variableName: "result_var",
      })
    })
  })

  describe("#given FINAL_VAR at line start", () => {
    it("#when parsing #then returns final_var payload without trimming", () => {
      const text = "prefix\nFINAL_VAR( result_var )\nsuffix"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toEqual({
        type: "final_var",
        variableName: " result_var ",
      })
    })

    it("#when FINAL_VAR is not at line start #then returns null", () => {
      const text = "prefix FINAL_VAR(result_var)"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toBeNull()
    })
  })

  describe("#given FINAL at line start", () => {
    it("#when payload is multiline #then captures content greedily", () => {
      const text = "note\nFINAL(line 1\nline 2)\nextra )"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toEqual({
        type: "final",
        content: "line 1\nline 2)\nextra ",
      })
    })

    it("#when FINAL is empty #then returns empty content", () => {
      const text = "FINAL()"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toEqual({
        type: "final",
        content: "",
      })
    })

    it("#when FINAL is not at line start #then returns null", () => {
      const text = "prefix FINAL(answer)"

      const parsed = parseFinalAnswer(text)

      expect(parsed).toBeNull()
    })
  })
})
