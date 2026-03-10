import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { RlmConfig } from "../../config/schema/experimental"
import { coordinator } from "../../features/rlm-context/coordinator"
import type { RlmContextManagerForPlan, RlmPlanToolOptions } from "./plan-tool"
import {
  createTrustedLocalRlmReplBackend,
  type RlmReplBackend,
} from "./repl-runtime"

export interface ExecOperationResult {
  executed: true
  output_variable?: string
  output?: string
}

export async function executeExecOperation(
  contextManager: RlmContextManagerForPlan,
  _options: RlmPlanToolOptions,
  context: ToolContext,
  operation: { op: "exec"; code: string; output_variable?: string },
  backend: RlmReplBackend | undefined,
  config: RlmConfig,
): Promise<ExecOperationResult> {
  const binding = coordinator.resolve(context.sessionID)
  if (!binding) {
    throw new Error("session_not_found")
  }

  const execBackend = backend ?? createTrustedLocalRlmReplBackend()

  const replContext = {
    sessionID: context.sessionID,
    query: binding.query,
    manager: binding.manager,
    toolContext: context,
    client: _options.client,
    directory: _options.directory,
    config,
  }

  const output = await execBackend.execute(operation.code, replContext)

  if (operation.output_variable) {
    await contextManager.createBlobVariable(
      context.sessionID,
      { name: operation.output_variable, content: output },
      { semanticType: "scratch" },
    )
  }

  return {
    executed: true,
    output_variable: operation.output_variable,
    output: operation.output_variable ? undefined : output,
  }
}
