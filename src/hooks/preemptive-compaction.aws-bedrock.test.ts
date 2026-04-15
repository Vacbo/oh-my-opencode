/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../config"

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

function resetContextLimitEnv(): void {
  if (originalAnthropicContextEnv === undefined) {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
  } else {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = originalAnthropicContextEnv
  }

  if (originalVertexContextEnv === undefined) {
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  } else {
    process.env[VERTEX_CONTEXT_ENV_KEY] = originalVertexContextEnv
  }
}

type HookContext = Parameters<typeof createPreemptiveCompactionHook>[0]

function createMockContext(): HookContext {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp/test",
  }
}

describe("preemptive-compaction aws-bedrock-anthropic", () => {
  beforeEach(() => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  })

  afterEach(() => {
    resetContextLimitEnv()
  })

  it("triggers compaction for aws-bedrock-anthropic provider when usage exceeds threshold", async () => {
    // given
    const ctx = createMockContext()
    const pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    const hook = createPreemptiveCompactionHook(ctx, pluginConfig)
    const sessionID = "ses_aws_bedrock_anthropic_high"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "aws-bedrock-anthropic",
            modelID: "claude-sonnet-4-6",
            finish: true,
            tokens: {
              input: 170000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    // when
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_aws_bedrock_1" },
      { title: "", output: "test", metadata: null },
    )

    // then
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })
})
