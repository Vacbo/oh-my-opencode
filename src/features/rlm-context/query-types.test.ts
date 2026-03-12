import { describe, expect, it } from "bun:test"
import type { RlmBinding, RlmContextManagerLike } from "./coordinator"
import type { RlmSessionState } from "./types"

const manager = {
  getVariableByName: () => undefined,
  readBlobContent: () => "",
  readManifest: () => [],
  listVariables: () => [],
  initSession: () => {
    throw new Error("not implemented")
  },
  getSession: () => undefined,
  createBlobVariable: () => {
    throw new Error("not implemented")
  },
  createManifestVariable: () => {
    throw new Error("not implemented")
  },
  resolveManifestItems: () => [],
  deleteSession: () => {},
} satisfies RlmContextManagerLike

describe("RLM query types", () => {
  it("stores rootQuery and taskPrompt on session state", () => {
    const session: RlmSessionState = {
      sessionId: "ses-root",
      depth: 0,
      maxDepth: 2,
      contextDir: "/tmp/rlm",
      rootQuery: "root question",
      taskPrompt: "root question",
      shouldDistill: false,
      variables: new Map(),
    }

    expect(session.rootQuery).toBe("root question")
    expect(session.taskPrompt).toBe("root question")
  })

  it("stores rootQuery and taskPrompt on coordinator bindings", () => {
    const binding: RlmBinding = {
      manager,
      rlmSessionId: "ses-child",
      depth: 1,
      rootQuery: "root question",
      taskPrompt: "child prompt",
      contextVariableName: "item",
      trusted: true,
    }

    expect(binding.rootQuery).toBe("root question")
    expect(binding.taskPrompt).toBe("child prompt")
  })
})
