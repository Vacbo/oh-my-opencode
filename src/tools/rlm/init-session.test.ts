import { describe, expect, it } from "bun:test"
import { createRlmBinding, initRlmSession } from "./init-session"
import type { RlmContextManagerForInit } from "./init-session"
import type {
  RlmBlobVariable,
  RlmSessionState,
  InitRlmSessionOptions,
  RlmSemanticType,
} from "../../features/rlm-context/types"

function createMockContextManager(): RlmContextManagerForInit {
  const sessions = new Map<string, RlmSessionState>()

  return {
    initSession(sessionId: string, options: InitRlmSessionOptions): RlmSessionState {
      const session: RlmSessionState = {
        sessionId,
        depth: options.depth ?? 0,
        maxDepth: options.maxDepth,
        contextDir: options.contextDir,
        rootQuery: options.rootQuery,
        taskPrompt: options.taskPrompt,
        shouldDistill: options.shouldDistill ?? false,
        parentSessionId: options.parentSessionId,
        variables: new Map(),
      }
      sessions.set(sessionId, session)
      return session
    },

    getSession(sessionId: string): RlmSessionState | undefined {
      return sessions.get(sessionId)
    },

    createBlobVariable(
      sessionId: string,
      input: { name: string; content?: string; file_path?: string },
      options?: { semanticType?: RlmSemanticType },
    ): RlmBlobVariable {
      const rawContent = input.content ?? ""
      return {
        sessionId,
        name: input.name,
        storageKind: "blob",
        semanticType: options?.semanticType ?? "derived",
        createdAt: Date.now(),
        filePath: `/tmp/mock/${sessionId}/${input.name}.blob`,
        byteSize: Buffer.byteLength(rawContent, "utf8"),
        source: input.file_path ? "file_path" : "content",
        lineCount: rawContent ? rawContent.split("\n").length : 0,
      }
    },
  }
}

describe("initRlmSession", () => {
  describe("#given XOR validation for content vs file_path", () => {
    it("#when both content and file_path #then throws", async () => {
      const manager = createMockContextManager()

      await expect(
        initRlmSession(manager, {
          sessionId: "ses-xor-both",
          query: "test",
          content: "inline",
          file_path: "/path/to/file",
          maxDepth: 2,
          contextDir: "/tmp",
        }),
      ).rejects.toThrow()
    })

    it("#when neither content nor file_path #then throws", async () => {
      const manager = createMockContextManager()

      await expect(
        initRlmSession(manager, {
          sessionId: "ses-xor-neither",
          query: "test",
          maxDepth: 2,
          contextDir: "/tmp",
        }),
      ).rejects.toThrow()
    })
  })

  describe("#given query is required", () => {
    it("#when query is missing #then throws", async () => {
      const manager = createMockContextManager()

      await expect(
        initRlmSession(manager, {
          sessionId: "ses-no-query",
          query: undefined as unknown as string,
          content: "data",
          maxDepth: 2,
          contextDir: "/tmp",
        }),
      ).rejects.toThrow()
    })
  })

  describe("#given child session with depth and parentSessionId", () => {
    it("#when depth and parentSessionId provided #then passes through to session", async () => {
      const manager = createMockContextManager()

      const result = await initRlmSession(manager, {
        sessionId: "ses-child",
        query: "summarize chunk",
        rootQuery: "root question",
        content: "chunk content",
        depth: 1,
        parentSessionId: "ses-parent",
        maxDepth: 3,
        contextDir: "/tmp/rlm",
      })

      expect(result.depth).toBe(1)
      expect(result.parentSessionId).toBe("ses-parent")
      const stored = manager.getSession("ses-child") as RlmSessionState | undefined
      expect(stored?.rootQuery).toBe("root question")
      expect(stored?.taskPrompt).toBe("summarize chunk")
    })
  })

  describe("#given root session initialization", () => {
    it("#when query is provided #then rootQuery and taskPrompt match", async () => {
      const manager = createMockContextManager()

      await initRlmSession(manager, {
        sessionId: "ses-root",
        query: "root prompt",
        content: "context",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
      })

      const stored = manager.getSession("ses-root") as RlmSessionState | undefined
      expect(stored?.rootQuery).toBe("root prompt")
      expect(stored?.taskPrompt).toBe("root prompt")
    })
  })

  describe("#given shouldDistill default", () => {
    it("#when shouldDistill omitted #then defaults to false", async () => {
      const manager = createMockContextManager()

      const result = await initRlmSession(manager, {
        sessionId: "ses-distill-default",
        query: "analyze",
        content: "data",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
      })

      expect(result.shouldDistill).toBe(false)
    })

    it("#when shouldDistill true #then preserves", async () => {
      const manager = createMockContextManager()

      const result = await initRlmSession(manager, {
        sessionId: "ses-distill-true",
        query: "analyze",
        content: "data",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
        shouldDistill: true,
      })

      expect(result.shouldDistill).toBe(true)
    })
  })

  describe("#given metadata-only return shape", () => {
    it("#when session initialized with content #then returns metadata without raw content", async () => {
      const manager = createMockContextManager()

      const result = await initRlmSession(manager, {
        sessionId: "ses-metadata",
        query: "summarize this",
        content: "line 1\nline 2\nline 3",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
      })

        expect(result.sessionId).toBe("ses-metadata")
        expect(result.depth).toBe(0)
        expect(result.maxDepth).toBe(2)
        expect(result.rootQuery).toBe("summarize this")
        expect(result.taskPrompt).toBe("summarize this")
        expect(result.shouldDistill).toBe(false)
      expect(result.contextMetadata.contextVariableName).toBe("context")
      expect(result.contextMetadata.contextSize).toBeGreaterThan(0)
      expect(result.contextMetadata.contextType).toBe("content")
      expect(result.contextMetadata.lineCount).toBe(3)

      const resultAsRecord = result as unknown as Record<string, unknown>
      expect(resultAsRecord["content"]).toBeUndefined()
      expect(resultAsRecord["file_path"]).toBeUndefined()
    })

    it("#when session initialized with file_path #then contextType is file_path", async () => {
      const manager = createMockContextManager()

      const result = await initRlmSession(manager, {
        sessionId: "ses-filepath",
        query: "analyze file",
        file_path: "/some/file.txt",
        maxDepth: 1,
        contextDir: "/tmp/rlm",
      })

      expect(result.contextMetadata.contextType).toBe("file_path")
    })
  })

  describe("#given session already exists", () => {
    it("#when getSession returns existing session #then skips initSession", async () => {
      const manager = createMockContextManager()

      await initRlmSession(manager, {
        sessionId: "ses-existing",
        query: "first init",
        content: "data",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
      })

      const result = await initRlmSession(manager, {
        sessionId: "ses-existing",
        query: "second init",
        content: "more data",
        maxDepth: 2,
        contextDir: "/tmp/rlm",
      })

      expect(result.rootQuery).toBe("first init")
      expect(result.taskPrompt).toBe("first init")
    })
  })

  describe("#given init result metadata", () => {
    it("#when creating a coordinator binding #then preserves rootQuery and taskPrompt", () => {
      const manager = createMockContextManager()

      const binding = createRlmBinding(manager as never, {
        sessionId: "ses-root",
        depth: 0,
        maxDepth: 2,
        rootQuery: "root prompt",
        taskPrompt: "task prompt",
        shouldDistill: false,
        contextMetadata: {
          contextVariableName: "context",
          contextSize: 12,
          contextType: "content",
          lineCount: 1,
        },
      }, true)

      expect(binding.rootQuery).toBe("root prompt")
      expect(binding.taskPrompt).toBe("task prompt")
    })
  })
})
