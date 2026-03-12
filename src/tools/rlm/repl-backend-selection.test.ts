/// <reference types="bun-types" />
import { afterEach, describe, expect, it } from "bun:test"
import {
  RlmConfigSchema,
  type RlmConfig,
} from "../../config/schema/experimental"
import { RlmErrorCode } from "../../features/rlm-context/error-codes"
import {
  bindTestCoordinator,
  createSession,
  createToolContext,
  dummyClient,
  InMemoryRlmManager,
  testRlmSessionId,
  unbindTestCoordinator,
} from "./plan-tool.test-helpers"
import { createRlmPlanTool } from "./plan-tool"
import {
  clearRlmReplNamespace,
  createRlmReplBackend,
} from "./repl-runtime"
import { clearVmSandboxNamespace } from "./vm-sandbox"

type TestSession = {
  sessionID: string
  rlmSessionId: string
  manager: InMemoryRlmManager
}

type RlmSandboxConfig = RlmConfig & {
  sandbox?: {
    enabled?: boolean
  }
}

const boundSessions: TestSession[] = []

function createConfig(overrides: Partial<RlmSandboxConfig> = {}): RlmSandboxConfig {
  const { sandbox, ...configOverrides } = overrides
  const config = RlmConfigSchema.parse(configOverrides)
  return sandbox ? { ...config, sandbox } : config
}

function setupSession(sessionID: string): TestSession {
  const manager = new InMemoryRlmManager()
  const rlmSessionId = testRlmSessionId(sessionID)
  manager.seedSession(createSession(rlmSessionId, "test query", "test query", 0, 3))
  manager.createBlobVariable(rlmSessionId, { name: "context", content: "seed context" })
  bindTestCoordinator(sessionID, manager)
  const session = { sessionID, rlmSessionId, manager }
  boundSessions.push(session)
  return session
}

function createExecContext(session: TestSession, config: RlmSandboxConfig) {
  return {
    sessionID: session.sessionID,
    rlmSessionId: session.rlmSessionId,
    rootQuery: "test query",
    taskPrompt: "test query",
    manager: session.manager,
    toolContext: createToolContext(session.sessionID),
    client: dummyClient,
    directory: "/tmp",
    config,
  }
}

afterEach(() => {
  while (boundSessions.length > 0) {
    const session = boundSessions.pop()!
    clearRlmReplNamespace(session.rlmSessionId)
    clearVmSandboxNamespace(session.rlmSessionId)
    unbindTestCoordinator(session.sessionID)
  }
})

describe("RLM repl backend selection", () => {
  it("uses the trusted local backend when sandbox mode is disabled", async () => {
    const session = setupSession("ses-local-backend")
    const config = createConfig()
    const backend = createRlmReplBackend(config)

    expect(
      await backend.execute('print(typeof process)', createExecContext(session, config)),
    ).toBe("object\n")
  })

  it("uses the VM sandbox backend when sandbox mode is enabled", async () => {
    const session = setupSession("ses-vm-backend")
    const config = createConfig({ sandbox: { enabled: true } })
    const backend = createRlmReplBackend(config)

    expect(
      await backend.execute('print(typeof process)', createExecContext(session, config)),
    ).toBe("undefined\n")
  })

  it("wires the selected backend through exec plan operations", async () => {
    const session = setupSession("ses-plan-vm-backend")
    const config = createConfig({ sandbox: { enabled: true } })
    const planTool = createRlmPlanTool({
      client: dummyClient,
      directory: "/tmp",
      config,
    })

    const result = JSON.parse(
      await planTool.execute(
        {
          operations: [
            { op: "exec", code: 'print(typeof process)', output_variable: "result" },
          ],
        },
        createToolContext(session.sessionID),
      ),
    ) as { error?: string; executed_ops?: number }

    expect(result.error).toBeUndefined()
    expect(result.executed_ops).toBe(1)
    const variable = session.manager.getVariableByName(session.rlmSessionId, "result")
    expect(variable?.storageKind).toBe("blob")
    if (!variable || variable.storageKind !== "blob") {
      throw new Error("expected result blob variable")
    }
    expect(session.manager.readBlobContent(variable)).toBe("undefined\n")
  })

  it("maps sandbox code generation violations to typed RLM errors", async () => {
    const session = setupSession("ses-vm-violation")
    const config = createConfig({ sandbox: { enabled: true } })
    const backend = createRlmReplBackend(config)
    const error = await backend.execute(
      'Function("return 1")()',
      createExecContext(session, config),
    ).catch((caught) => caught)

    expect(error).toMatchObject({ code: RlmErrorCode.EXEC_SANDBOX_VIOLATION })
  })

  it("maps sandbox timeout failures to typed RLM errors", async () => {
    const session = setupSession("ses-vm-timeout-error")
    const config = createConfig({
      sandbox: { enabled: true },
      exec: { trusted_only: true, timeout_ms: 1000, print_limit_bytes: 2048 },
    })
    const backend = createRlmReplBackend(config)
    const error = await backend.execute(
      "while (true) {}",
      createExecContext(session, config),
    ).catch((caught) => caught)

    expect(error).toMatchObject({ code: RlmErrorCode.EXEC_TIMEOUT })
  })
})
