import { initRlmSession } from "./init-session"
import { parseFinalAnswer } from "./parser"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"
import type { RlmReplBackend } from "./repl-runtime"

export interface RlmPlanExecutorDeps {
  runSyncSubcall: typeof runSyncSubcall
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  initRlmSession: typeof initRlmSession
  parseFinalAnswer: typeof parseFinalAnswer
  replBackend?: RlmReplBackend
}

export const defaultRlmPlanExecutorDeps: RlmPlanExecutorDeps = {
  runSyncSubcall,
  cleanupSyncSubcallSession,
  initRlmSession,
  parseFinalAnswer,
}
