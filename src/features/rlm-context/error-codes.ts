/**
 * Typed error taxonomy for all RLM tool errors.
 *
 * Provides a single enum of error codes, a flat RlmError class,
 * a factory that attaches human-readable defaults, and a
 * backward-compatible JSON serializer.
 */

export enum RlmErrorCode {
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  VARIABLE_NOT_FOUND = "VARIABLE_NOT_FOUND",
  MANIFEST_REJECTED = "MANIFEST_REJECTED",
  MANIFEST_INTEGRITY_ERROR = "MANIFEST_INTEGRITY_ERROR",
  MANIFEST_CORRUPT_ERROR = "MANIFEST_CORRUPT_ERROR",
  EXEC_UNTRUSTED = "EXEC_UNTRUSTED",
  EXEC_TIMEOUT = "EXEC_TIMEOUT",
  EXEC_SANDBOX_VIOLATION = "EXEC_SANDBOX_VIOLATION",
  EXEC_MEMORY_LIMIT = "EXEC_MEMORY_LIMIT",
  DEPTH_LIMIT = "DEPTH_LIMIT",
  PLAN_OP_FAILED = "PLAN_OP_FAILED",
  SUBCALL_FAILED = "SUBCALL_FAILED",
  OFFLOAD_FAILED = "OFFLOAD_FAILED",
  PERSISTENCE_FAILED = "PERSISTENCE_FAILED",
  INVALID_INPUT = "INVALID_INPUT",
  INVALID_REF = "INVALID_REF",
  INVALID_RANGE = "INVALID_RANGE",
  INVALID_STORAGE_KIND = "INVALID_STORAGE_KIND",
  INVALID_PATTERN = "INVALID_PATTERN",
  UNSUPPORTED_VARIABLE_KIND = "UNSUPPORTED_VARIABLE_KIND",
  REGEX_ERROR = "REGEX_ERROR",
  REGEX_GUARD_FAILURE = "REGEX_GUARD_FAILURE",
  REGEX_TIMEOUT = "REGEX_TIMEOUT",
  TOO_MANY_OPERATIONS = "TOO_MANY_OPERATIONS",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

const DEFAULT_USER_MESSAGES: Record<RlmErrorCode, string> = {
  [RlmErrorCode.SESSION_NOT_FOUND]: "RLM session not found for this chat.",
  [RlmErrorCode.VARIABLE_NOT_FOUND]: "The requested variable does not exist.",
  [RlmErrorCode.MANIFEST_REJECTED]: "The variable manifest was rejected.",
  [RlmErrorCode.MANIFEST_INTEGRITY_ERROR]: "Manifest references missing blob files.",
  [RlmErrorCode.MANIFEST_CORRUPT_ERROR]: "Manifest file is corrupted or invalid.",
  [RlmErrorCode.EXEC_UNTRUSTED]: "Execution blocked: untrusted code.",
  [RlmErrorCode.EXEC_TIMEOUT]: "Execution timed out.",
  [RlmErrorCode.EXEC_SANDBOX_VIOLATION]: "Execution violated sandbox constraints.",
  [RlmErrorCode.EXEC_MEMORY_LIMIT]: "Execution exceeded memory limit.",
  [RlmErrorCode.DEPTH_LIMIT]: "Maximum recursion depth exceeded.",
  [RlmErrorCode.PLAN_OP_FAILED]: "A plan operation failed.",
  [RlmErrorCode.SUBCALL_FAILED]: "A subcall failed to complete.",
  [RlmErrorCode.OFFLOAD_FAILED]: "Failed to offload work.",
  [RlmErrorCode.PERSISTENCE_FAILED]: "Failed to persist session data.",
  [RlmErrorCode.INVALID_INPUT]: "Invalid input arguments.",
  [RlmErrorCode.INVALID_REF]: "Invalid variable reference.",
  [RlmErrorCode.INVALID_RANGE]: "Invalid range specification.",
  [RlmErrorCode.INVALID_STORAGE_KIND]: "Unsupported storage kind for this operation.",
  [RlmErrorCode.INVALID_PATTERN]: "Invalid search pattern.",
  [RlmErrorCode.UNSUPPORTED_VARIABLE_KIND]: "This variable kind is not supported for the requested operation.",
  [RlmErrorCode.REGEX_ERROR]: "Invalid regular expression.",
  [RlmErrorCode.REGEX_GUARD_FAILURE]: "Regular expression failed safety checks.",
  [RlmErrorCode.REGEX_TIMEOUT]: "Regular expression matching timed out.",
  [RlmErrorCode.TOO_MANY_OPERATIONS]: "Too many operations in a single request.",
  [RlmErrorCode.INTERNAL_ERROR]: "An internal error occurred.",
};

/**
 * Maps an RlmErrorCode to the backward-compatible slug string
 * used in existing JSON error responses.
 */
const BACKWARD_COMPAT_SLUGS: Record<RlmErrorCode, string> = {
  [RlmErrorCode.SESSION_NOT_FOUND]: "session_not_found",
  [RlmErrorCode.VARIABLE_NOT_FOUND]: "variable_not_found",
  [RlmErrorCode.MANIFEST_REJECTED]: "manifest_not_allowed",
  [RlmErrorCode.MANIFEST_INTEGRITY_ERROR]: "manifest_integrity_error",
  [RlmErrorCode.MANIFEST_CORRUPT_ERROR]: "manifest_corrupt_error",
  [RlmErrorCode.EXEC_UNTRUSTED]: "exec_untrusted",
  [RlmErrorCode.EXEC_TIMEOUT]: "exec_timeout",
  [RlmErrorCode.EXEC_SANDBOX_VIOLATION]: "exec_sandbox_violation",
  [RlmErrorCode.EXEC_MEMORY_LIMIT]: "exec_memory_limit",
  [RlmErrorCode.DEPTH_LIMIT]: "depth_limit",
  [RlmErrorCode.PLAN_OP_FAILED]: "plan_execution_error",
  [RlmErrorCode.SUBCALL_FAILED]: "subcall_failed",
  [RlmErrorCode.OFFLOAD_FAILED]: "offload_failed",
  [RlmErrorCode.PERSISTENCE_FAILED]: "persistence_failed",
  [RlmErrorCode.INVALID_INPUT]: "invalid_arguments",
  [RlmErrorCode.INVALID_REF]: "invalid_ref",
  [RlmErrorCode.INVALID_RANGE]: "invalid_range",
  [RlmErrorCode.INVALID_STORAGE_KIND]: "invalid_storage_kind",
  [RlmErrorCode.INVALID_PATTERN]: "invalid_pattern",
  [RlmErrorCode.UNSUPPORTED_VARIABLE_KIND]: "unsupported_variable_kind",
  [RlmErrorCode.REGEX_ERROR]: "invalid_regex",
  [RlmErrorCode.REGEX_GUARD_FAILURE]: "regex_guard_failure",
  [RlmErrorCode.REGEX_TIMEOUT]: "regex_timeout",
  [RlmErrorCode.TOO_MANY_OPERATIONS]: "too_many_operations",
  [RlmErrorCode.INTERNAL_ERROR]: "internal_error",
};

export interface RlmErrorContext {
  [key: string]: unknown;
}

export class RlmError extends Error {
  readonly code: RlmErrorCode;
  readonly context: RlmErrorContext;
  readonly userMessage: string;

  constructor(code: RlmErrorCode, userMessage: string, context: RlmErrorContext = {}) {
    super(userMessage);
    this.name = "RlmError";
    this.code = code;
    this.userMessage = userMessage;
    this.context = context;
  }
}

/**
 * Factory: create an RlmError with code-specific default userMessage.
 * The caller can override the message or add context.
 */
export function rlmError(
  code: RlmErrorCode,
  context?: RlmErrorContext & { message?: string },
): RlmError {
  const userMessage = context?.message ?? DEFAULT_USER_MESSAGES[code];
  const cleanContext = { ...context };
  delete cleanContext.message;
  return new RlmError(code, userMessage, cleanContext);
}

export interface RlmErrorJson {
  /** Backward-compatible slug (e.g. "session_not_found") */
  error: string;
  /** Typed enum code (e.g. "SESSION_NOT_FOUND") */
  code: RlmErrorCode;
  /** Human-readable message */
  message: string;
  /** Extra context fields merged at top level */
  [key: string]: unknown;
}

/**
 * Serialize an RlmError (or plain Error) into the standard JSON contract.
 *
 * - `error`   = backward-compat slug
 * - `code`    = RlmErrorCode enum value
 * - `message` = human-readable text
 * - ...context fields spread at top level
 */
export function toErrorJson(error: RlmError | Error): RlmErrorJson {
  if (error instanceof RlmError) {
    return {
      error: BACKWARD_COMPAT_SLUGS[error.code],
      code: error.code,
      message: error.userMessage,
      ...error.context,
    };
  }

  return {
    error: "internal_error",
    code: RlmErrorCode.INTERNAL_ERROR,
    message: error.message || "An internal error occurred.",
  };
}

/**
 * Look up the backward-compatible slug for a given error code.
 */
export function errorSlug(code: RlmErrorCode): string {
  return BACKWARD_COMPAT_SLUGS[code];
}

/**
 * Look up the default user-facing message for a given error code.
 */
export function defaultMessage(code: RlmErrorCode): string {
  return DEFAULT_USER_MESSAGES[code];
}
