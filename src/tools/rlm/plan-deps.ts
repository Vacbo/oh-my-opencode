import { initRlmSession, type RlmContextManagerForInit } from "./init-session"
import { parseFinalAnswer } from "./parser"
import {
  createRlmReplBackend,
  type RlmReplBackend,
} from "./repl-runtime"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"
import type { RlmContextManagerForPlan } from "./plan-tool"

export interface RlmPlanExecutorDeps {
  runSyncSubcall: typeof runSyncSubcall
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  initRlmSession: (contextManager: RlmContextManagerForPlan, input: Parameters<typeof initRlmSession>[1]) => ReturnType<typeof initRlmSession>
  parseFinalAnswer: typeof parseFinalAnswer
  replBackend: RlmReplBackend
}

export const defaultRlmPlanExecutorDeps: RlmPlanExecutorDeps = {
  runSyncSubcall,
  cleanupSyncSubcallSession,
  initRlmSession,
  parseFinalAnswer,
  replBackend: {
    execute: (code, context) => createRlmReplBackend(context.config).execute(code, context),
  },
}
