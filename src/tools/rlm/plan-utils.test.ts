import { describe, expect, it } from "bun:test"
import { fillTemplate } from "./plan-utils"

describe("fillTemplate", () => {
  it("expands task and root query separately", () => {
    const result = fillTemplate(
      "ROOT={{root_query}} TASK={{query}} ITEM={{item}}",
      { rootQuery: "root question", taskPrompt: "child prompt" },
      "chunk text",
    )

    expect(result).toBe("ROOT=root question TASK=child prompt ITEM=chunk text")
  })
})
