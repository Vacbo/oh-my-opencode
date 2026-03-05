import { initRlmSession } from "./init-session"
import { parseFinalAnswer } from "./parser"
import {
  cleanupSyncSubcallSession,
  runSyncSubcall,
} from "./subcall-runner"

export interface RlmPlanExecutorDeps {
  runSyncSubcall: typeof runSyncSubcall
  cleanupSyncSubcallSession: typeof cleanupSyncSubcallSession
  initRlmSession: typeof initRlmSession
  parseFinalAnswer: typeof parseFinalAnswer
}

export const defaultRlmPlanExecutorDeps: RlmPlanExecutorDeps = {
  runSyncSubcall,
  cleanupSyncSubcallSession,
  initRlmSession,
  parseFinalAnswer,
}
