import { initRlmSession } from "./init-session"
import { parseFinalAnswer } from "./parser"
import { createVmSandboxRlmReplBackend } from "./vm-sandbox"
import type { RlmReplBackend } from "./repl-runtime"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"

export interface RlmPlanExecutorDeps {
  runSyncSubcall: typeof runSyncSubcall
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  initRlmSession: typeof initRlmSession
  parseFinalAnswer: typeof parseFinalAnswer
  replBackend: RlmReplBackend
}

export const defaultRlmPlanExecutorDeps: RlmPlanExecutorDeps = {
  runSyncSubcall,
  cleanupSyncSubcallSession,
  initRlmSession,
  parseFinalAnswer,
  replBackend: createVmSandboxRlmReplBackend(),
}
