# src/features/rlm-context/ — Symbolic Context Store

**Generated:** 2026-03-12

## OVERVIEW

Disk-backed symbolic variable store for RLM (Recursive Language Model) sessions. Manages session lifecycle, blob and manifest variables, persistent context storage, budget tracking, context rot detection, and trace distillation. The store is the foundation of paper-faithful RLM: context is never directly visible to the model; instead, the model interacts with it symbolically through bounded operations.

## FILE STRUCTURE

| File | Purpose |
|------|---------|
| `types.ts` | Type contracts: `RlmSessionState`, `RlmBlobVariable`, `RlmManifestVariable`, `InitRlmSessionOptions` |
| `manager.ts` | `RlmContextManager` class: session init, variable creation, manifest resolution, deletion |
| `manager.test.ts` | Unit tests for store operations (blob/manifest round-trip, deletion, path safety) |
| `path-guards.ts` | Path safety: `resolveSessionDir()`, `resolveSessionFilePath()`, traversal rejection |
| `variable-input-parser.ts` | Input normalization: `parseBlobInput()`, `parseManifestInput()` |
| `index.ts` | Barrel export: `RlmContextManager`, types, path guards |
| `coordinator.ts` | `RlmSessionCoordinator` singleton: binds sessionID → RlmBinding with budget/tracer |
| `turn-feedback.ts` | Metadata-only feedback: `shouldOffload()`, `offloadOutput()`, `applyFeedback()` |
| `error-codes.ts` | `RlmErrorCode` enum (25 codes) and `RlmError` class |
| `tracer.ts` | `RlmTracer` interface and span-based session tracing |
| `budget.ts` | `SessionBudget`: subcall count, output bytes, wall-time tracking |
| `context-rot.ts` | `detectContextRot()`: heuristic rot detection from traced trajectories |
| `trace-distiller.ts` | `captureDistilledTrace()`: capture-only distillation for few-shot learning |
| `persistence.ts` | `RlmPersistence`: session state persistence with retry mechanism |
| `persistence-helpers.ts` | `withRetry()`: generic retry with exponential backoff for I/O operations |

## STORE TYPES

### Blob Variables (`storageKind: 'blob'`)

Opaque binary/text content stored on disk. Metadata only in memory.

```typescript
interface RlmBlobVariable {
  sessionId: string
  name: string
  storageKind: 'blob'
  semanticType: 'context' | 'derived' | 'result' | 'scratch'
  createdAt: number
  filePath: string              // relative path under session dir
  byteSize: number
  source: 'content' | 'file_path'
  lineCount: number
}
```

**Semantics:**
- `context`: Original input context (e.g., from `/rlm` command)
- `derived`: Output from a plan operation (e.g., `split`, `map_llm`)
- `result`: Final answer variable
- `scratch`: Temporary working variable

### Manifest Variables (`storageKind: 'manifest'`)

Ordered list of child blob variable names, persisted as JSON. Used by plan operations to track collections.

```typescript
interface RlmManifestVariable {
  sessionId: string
  name: string
  storageKind: 'manifest'
  semanticType: 'context' | 'derived' | 'result' | 'scratch'
  createdAt: number
  filePath: string              // relative path to .json file
  byteSize: number
  itemCount: number
}
```

**Manifest JSON format:**
```json
{
  "items": ["chunk_0", "chunk_1", "chunk_2"]
}
```

Order is preserved on read. Manifests are never returned as final answers; only blobs can be terminal.

## SESSION LIFECYCLE

### Initialization

```typescript
const session = await manager.initSession(sessionId, {
  maxDepth: 1,
  contextDir: '.sisyphus/rlm-contexts',
  query: 'user query',
  depth: 0,                    // optional, defaults to 0
  parentSessionId: undefined,  // optional, set for child sessions
  shouldDistill: false,        // optional, defaults to false
})
```

**Behavior:**
- Creates session directory under `contextDir/sessionId/`
- Initializes `RlmSessionState` with empty variables map
- Returns session state (not persisted to disk; in-memory only)
- Idempotent: calling twice with same `sessionId` returns existing session

### Variable Creation

**Blob from content:**
```typescript
const blob = await manager.createBlobVariable(sessionId, {
  name: 'context',
  content: 'file contents...'
}, { semanticType: 'context' })
```

**Blob from file:**
```typescript
const blob = await manager.createBlobVariable(sessionId, {
  name: 'result',
  file_path: '/path/to/file.txt'
}, { semanticType: 'result' })
```

**Manifest from child names:**
```typescript
const manifest = await manager.createManifestVariable(sessionId, {
  name: 'chunks',
  items: ['chunk_0', 'chunk_1', 'chunk_2']
})
```

**Behavior:**
- Validates variable name is unique within session
- Writes blob content to disk under `sessionId/{name}.blob`
- Writes manifest JSON to disk under `sessionId/{name}.manifest.json`
- Stores metadata in session's variables map
- Returns metadata-only variable object

### Variable Inspection

**Get variable metadata:**
```typescript
const variable = await manager.getVariableByName(sessionId, 'context')
// Returns RlmBlobVariable | RlmManifestVariable | undefined
```

**Read blob content:**
```typescript
const content = await manager.readBlobContent(blobVariable)
// Returns full file contents as string
```

**Read manifest items:**
```typescript
const manifest = await manager.readManifest(manifestVariable)
// Returns { items: ['chunk_0', 'chunk_1', ...] }
```

**Resolve manifest items:**
```typescript
const blobs = await manager.resolveManifestItems(sessionId, 'chunks')
// Returns array of RlmBlobVariable objects in manifest order
```

**List all variables:**
```typescript
const vars = await manager.listVariables(sessionId)
// Returns array of RlmContextVariable (both blob and manifest)
```

### Session Deletion

```typescript
await manager.deleteSession(sessionId)
```

**Behavior:**
- Removes session entry from in-memory sessions map
- Deletes entire session directory and all variable files
- Idempotent: deleting non-existent session is a no-op
- Called automatically on `session.deleted` event

## KEY METHODS

### `RlmContextManager`

| Method | Signature | Returns |
|--------|-----------|---------|
| `initSession` | `(sessionId, options) => Promise<RlmSessionState>` | Session state |
| `getSession` | `(sessionId) => RlmSessionState \| undefined` | Session or undefined |
| `createBlobVariable` | `(sessionId, input, options?) => Promise<RlmBlobVariable>` | Blob metadata |
| `createManifestVariable` | `(sessionId, input, options?) => Promise<RlmManifestVariable>` | Manifest metadata |
| `getVariableByName` | `(sessionId, name) => Promise<RlmContextVariable \| undefined>` | Variable or undefined |
| `readBlobContent` | `(variable) => Promise<string>` | Full blob contents |
| `readManifest` | `(variable) => Promise<{ items: string[] }>` | Manifest structure |
| `resolveManifestItems` | `(sessionId, manifestName) => Promise<RlmBlobVariable[]>` | Ordered blob array |
| `listVariables` | `(sessionId) => Promise<RlmContextVariable[]>` | All variables |
| `deleteSession` | `(sessionId) => Promise<void>` | — |

## STORAGE LAYOUT

```
.sisyphus/rlm-contexts/
├── {sessionId}/
│   ├── context.blob                    # Root context blob
│   ├── chunk_0.blob                    # Split chunk
│   ├── chunk_1.blob
│   ├── chunks.manifest.json            # Manifest listing chunks
│   ├── result.blob                     # Final result
│   └── ...
└── {childSessionId}/
    └── ...
```

**Path Safety:**
- All paths resolved under `contextDir/sessionId/`
- Traversal attempts (e.g., `../../../etc/passwd`) are rejected
- Symlinks are not followed

## SEMANTICS

### `rootQuery` and `taskPrompt`

Session state stores two query fields:
- `rootQuery`: The original user query, propagated unchanged to all child sessions
- `taskPrompt`: The per-session task prompt; in child sessions this is the map/reduce prompt with `{{item}}` expanded

Plan template expansion: `{{rootQuery}}` maps to `rootQuery`, `{{query}}` maps to `taskPrompt`.

### `shouldDistill` Flag

Stored on session state, defaults to `false`. When `true`, the RLM output distiller hook may truncate oversized tool outputs. Set by `/rlm` command or plan operations.

### `depth` and `maxDepth`

- `depth`: Current recursion level (0 = root)
- `maxDepth`: Maximum allowed depth (e.g., 1 = no recursion)
- Child sessions increment depth by 1
- When `depth + 1 >= maxDepth`, recursive operations downgrade to plain LM

### `parentSessionId`

Set only on child sessions. Allows cleanup to trace parent-child relationships.

## INTEGRATION POINTS

- **`/rlm` command**: Calls `initRlmSession()` helper before first model turn
- **`rlm_probe`**: Uses `getVariableByName()`, `readBlobContent()`, `listVariables()`
- **`rlm_search`**: Uses `getVariableByName()`, `readBlobContent()`
- **`rlm_plan`**: Creates/reads blobs and manifests during operation execution
- **`rlm_finish`**: Uses `getVariableByName()`, `readBlobContent()`
- **Session cleanup**: Calls `deleteSession()` on `session.deleted` event

## TESTING

Tests cover:
- **manager.test.ts**: Session init, blob/manifest round-trip, deletion, path safety, manifest integrity verification
- **budget.test.ts**: Budget creation, wall-time tracking, subcall counting, output byte accumulation, depth reduction advisory
- **context-rot.test.ts**: Scoring, indicator detection, recommendation thresholds, check interval cadence
- **trace-distiller.test.ts**: Capture gating (disabled/non-terminal/error), field extraction, disk storage, silent fail
- **persistence.test.ts**: Retry mechanism (ENOENT/EACCES/EBUSY/EAGAIN), exponential backoff, permanent error bypass
- **error-codes.test.ts**: All 25 error codes, `RlmError` class, `toErrorJson` serialization

## COORDINATOR PATTERN

The `RlmSessionCoordinator` is the single source of truth for active RLM sessions. It maps root chat session IDs to `RlmBinding` objects.

### RlmSessionCoordinator

```typescript
class RlmSessionCoordinator {
  bind(rootChatSessionId: string, binding: RlmBinding): void
  resolve(rootChatSessionId: string): RlmBinding | undefined
  unbind(rootChatSessionId: string): void
  // Budget management (Phase 4)
  initializeRootBudget(rootChatSessionId: string, budget: SessionBudget): SessionBudget | undefined
  getRootBudget(rootChatSessionId: string): SessionBudget | undefined
  incrementSubcallCount(rootChatSessionId: string): number | undefined
  addOutputBytes(rootChatSessionId: string, bytes: number): number | undefined
  getBudgetSummary(rootChatSessionId: string): SessionBudgetSummary | undefined
  setPersistence(p: RlmPersistence): void
}

export const coordinator = new RlmSessionCoordinator()
```

**Budget sharing:** Child bindings reuse the root `SessionBudget` reference via `rootRlmSessionId`. The coordinator resolves the root chat session from the root RLM session ID to find the shared budget.

### RlmBinding

```typescript
interface RlmBinding {
  manager: RlmContextManagerLike    // Context manager for variable operations
  rlmSessionId: string              // RLM session ID (may differ from chat session)
  rootRlmSessionId?: string         // Root session ID for budget sharing across children
  depth: number                     // Current recursion depth (0 = root)
  rootQuery: string                 // Original user query (propagated to all children)
  taskPrompt: string                // Per-session task prompt (may differ in children)
  contextVariableName: string       // Name of the pre-injected context variable
  trusted: boolean                  // Whether exec operations are permitted
  budget?: SessionBudget            // Root-owned budget, shared by children via rootRlmSessionId
  tracer?: RlmTracer                // Optional tracer for span-based operation tracking
}
```

All four tools resolve their binding via `coordinator.resolve(context.sessionID)`. Tools return `{ error: "session_not_found" }` when no binding exists.

**rootQuery vs taskPrompt:** The `rootQuery` is the original user query and stays constant across all child sessions. The `taskPrompt` is the per-session prompt (e.g., for `map_rlm` children, it contains the per-item prompt). Template expansion uses `{{rootQuery}}` and `{{query}}` (which maps to `taskPrompt`).

### Lifecycle

1. **Bind:** `/rlm` command or `initRlmSession()` creates session and binds coordinator
2. **Resolve:** Every tool call resolves binding from the coordinator
3. **Unbind:** `rlm_finish`, `FINAL()`, or `FINAL_VAR()` detection unbinds the session

## TURN FEEDBACK

The turn-feedback module enforces metadata-only output at the conversation history boundary.

### `shouldOffload(byteSize, config)`

Returns `true` when `byteSize > config.feedback.output_threshold_bytes` (default: 2048).

### `offloadOutput(content, sessionID, toolName, manager, config)`

Stores content in a hidden blob variable (`__hidden_{toolName}-{uuid}`), returns:

```typescript
{ ref: "hidden://{suffix}", variableName: "__hidden_{suffix}", preview: content.slice(0, 200) }
```

### `applyFeedback(output, sessionID, toolName, binding, config)`

Orchestrator function:
- Returns `output` unchanged if `toolName === "rlm_finish"` (bypass)
- Returns `output` unchanged if below threshold
- Calls `offloadOutput()` and returns JSON metadata if above threshold

### `getHiddenVariableName(ref)`

Converts a `hidden://` ref back to the `__hidden_*` variable name for `inspect_ref`.

## VARIABLE TYPES

### Hidden Refs (`__hidden_*` prefix)

Hidden variables store offloaded tool outputs. They are:
- Created automatically by `offloadOutput()` when output exceeds threshold
- Named with `__hidden_` prefix followed by `{toolName}-{uuid}`
- Inspectable via `rlm_probe` `inspect_ref` operation (returns bounded preview only)
- Stored as blob variables with `semanticType: "scratch"`
- Invisible to `list_vars` unless the model explicitly requests them

The ref format is `hidden://{suffix}` where suffix maps to `__hidden_{suffix}` variable name.

## ERROR TAXONOMY

RLM uses a typed error taxonomy with 25 error codes defined in `RlmErrorCode`.

| Code | Description |
|------|-------------|
| `SESSION_NOT_FOUND` | RLM session not found for this chat. |
| `VARIABLE_NOT_FOUND` | The requested variable does not exist. |
| `MANIFEST_REJECTED` | The variable manifest was rejected. |
| `EXEC_UNTRUSTED` | Execution blocked: untrusted code. |
| `EXEC_TIMEOUT` | Execution timed out. |
| `EXEC_SANDBOX_VIOLATION` | Execution violated sandbox constraints. |
| `EXEC_MEMORY_LIMIT` | Execution exceeded memory limit. |
| `DEPTH_LIMIT` | Maximum recursion depth exceeded. |
| `PLAN_OP_FAILED` | A plan operation failed. |
| `SUBCALL_FAILED` | A subcall failed to complete. |
| `OFFLOAD_FAILED` | Failed to offload work. |
| `PERSISTENCE_FAILED` | Failed to persist session data. |
| `INVALID_INPUT` | Invalid input arguments. |
| `INVALID_REF` | Invalid variable reference. |
| `INVALID_RANGE` | Invalid range specification. |
| `INVALID_STORAGE_KIND` | Unsupported storage kind for this operation. |
| `INVALID_PATTERN` | Invalid search pattern. |
| `UNSUPPORTED_VARIABLE_KIND` | This variable kind is not supported for the requested operation. |
| `REGEX_ERROR` | Invalid regular expression. |
| `REGEX_GUARD_FAILURE` | Regular expression failed safety checks. |
| `REGEX_TIMEOUT` | Regular expression matching timed out. |
| `TOO_MANY_OPERATIONS` | Too many operations in a single request. |
| `MANIFEST_INTEGRITY_ERROR` | Manifest references missing blob files on disk. |
| `MANIFEST_CORRUPT_ERROR` | Manifest JSON is invalid or not an array of strings. |
| `INTERNAL_ERROR` | An internal error occurred. |

**Usage:**
```typescript
import { rlmError, RlmErrorCode, toErrorJson } from "./error-codes"

// Create error
const err = rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, { name: "missing_var" })

// Serialize for tool response
return JSON.stringify(toErrorJson(err))
```

## BUDGET BROKER

The budget module tracks resource consumption across an RLM session tree.

### `SessionBudget`

```typescript
interface SessionBudget {
  subcall_count: number          // Total subcalls made
  output_bytes: number           // Total output bytes accumulated
  wall_time_ms: number           // Wall time since session start
  wall_time_start_ms: number     // Start timestamp (performance.now())
  max_subcalls: number           // From config.session_budget (default 20)
  max_output_bytes: number       // Default 10MB
  max_wall_time_ms: number       // Default 300000 (5 min)
  rootRlmSessionId: string       // Root session owning this budget
}
```

**Functions:**
- `createSessionBudget(config, rootRlmSessionId, now)`: initialize with config defaults
- `updateWallTimeMs(budget, now)`: recalculate elapsed wall time
- `incrementSubcallCount(budget, now)`: increment and update wall time
- `addOutputBytes(budget, bytes, now)`: accumulate output and update wall time
- `toSessionBudgetSummary(budget, now)`: compact `{ subcall_count, output_bytes, wall_time_ms }`
- `shouldReduceDepth(budget, session, now)`: returns `true` when any resource usage exceeds 80%

**Advisory only:** The budget broker does not enforce limits directly. Enforcement happens at call sites (e.g., `sub_rlm` checks `subcall_limit`, plan results include budget summary).

## CONTEXT ROT DETECTION

Heuristic detection of unproductive RLM trajectories based on traced spans.

### `detectContextRot(spans, config)`

Analyzes operation spans to produce a `ContextRotSignal`:

| Indicator | Weight | Trigger |
|-----------|--------|---------|
| `repeated_searches` | 0.25 | Same search pattern used > 2 times |
| `repeated_probes` | 0.30 | Same variable probed > 3 times |
| `no_new_vars` | 0.20 | 5+ consecutive operations create no new variables |
| `rising_ref_count` | 0.35 | 3+ unresolved hidden refs with zero resolutions |

**Score to recommendation:**
- `0`: `healthy`
- `< warning_threshold` (default 0.5): `monitor`
- `< 0.9`: `warning`
- `>= 0.9`: `suggest_finish`

### `shouldCheckContextRot(operationCount, config)`

Returns `true` when `operationCount % check_interval === 0` (default interval: 5). Plan executor emits observational `plan.context_rot` spans at this cadence using cumulative traced operations.

## TRACE DISTILLATION

Capture-only distillation of successful RLM traces for future few-shot learning.

### `captureDistilledTrace(sessionId, spans, options, config)`

**Captures when:** `distill_enabled && terminal && last span status === "ok"`

**Returns:** `DistilledTrace` with `sessionId`, `rootQuery`, `taskPrompt`, `finalAnswer`, `depth`, `maxDepth`, `model`, `provider`, `operations[]`, `capturedAt`

**Storage:** `{spans_dir}/distilled/{sessionId}.json`

**Skips when:** distill disabled, non-terminal, empty spans, last span has error status. Silent fail on file write errors (matches tracer.ts pattern).

**Scope:** Capture only. No retrieval, similarity matching, or prompt injection.

## SESSION TRACER

The `RlmTracer` provides structured, span-based tracing for RLM operations.

**Features:**
- **Spans:** Track start/end time, status, and metadata for each operation
- **Parent-Child Correlation:** Spans can be nested to represent recursive calls
- **Output Modes:** `log` (to console), `file` (to `.jsonl`), or `both`
- **Trace Tree:** Reconstruct the full execution tree from spans

**Interface:**
```typescript
export interface RlmTracer {
  startSpan(chatSessionId, rlmSessionId, operation, parentSpanId?, metadata?): RlmSpan
  endSpan(spanId, status, error?): void
  getSpans(rlmSessionId): RlmSpan[]
  getTrace(rootSpanId): SpanTreeNode | undefined
}
```

**Span metadata (Phase 4):** Spans optionally include `operation_name`, `operation_args`, and `variables_created` for context rot detection and trace distillation.

## CONFIGURATION

RLM configuration lives under `experimental.rlm` in the plugin config:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable RLM tools |
| `max_depth` | `number` | `1` | Maximum recursion depth (1–5) |
| `context_storage_dir` | `string` | `.sisyphus/rlm-contexts` | Base directory for session storage |
| `distill_threshold_tokens` | `number` | `2000` | Token threshold for distillation |
| `probe_max_lines` | `number` | `200` | Maximum lines returned by probe operations |
| `feedback.output_threshold_bytes` | `number` | `2048` | Byte threshold for output offloading |
| `exec.trusted_only` | `boolean` | `true` | Require trusted binding for exec |
| `exec.timeout_ms` | `number` | `30000` | Exec operation timeout |
| `exec.print_limit_bytes` | `number` | `2048` | Print output limit before offloading |
| `sandbox.enabled` | `boolean` | `true` | Enable `node:vm` sandbox for exec |
| `sandbox.memory_limit_mb` | `number` | `128` | Memory limit for sandbox |
| `sandbox.stack_depth_limit` | `number` | `1000` | Stack depth limit for sandbox |
| `progress.enabled` | `boolean` | `true` | Enable progress events for plans |
| `progress.throttle_ms` | `number` | `200` | Throttle for progress events |
| `progress.streaming_enabled` | `boolean` | `true` | Enable streaming partial results |
| `progress.streaming_throttle_ms` | `number` | `100` | Throttle for streaming events |
| `tracing.enabled` | `boolean` | `false` | Enable session tracing |
| `tracing.output` | `string` | `"log"` | Trace output: `log`, `file`, or `both` |
| `tracing.spans_dir` | `string` | `".sisyphus/rlm-traces"` | Directory for trace files |
| `tracing.distill_enabled` | `boolean` | `false` | Enable trace distillation capture |
| `session_budget` | `number` | `20` | Max subcalls per root session |
| `subcall_limit` | `number` | `10` | Max subcalls per `sub_rlm()` |
| `subcall_backoff_multiplier` | `number` | `1.5` | Exponential backoff multiplier |
| `subcall_jitter_percent` | `number` | `15` | Jitter percentage for polling |
| `subcall_max_interval_ms` | `number` | `5000` | Max polling interval |
| `parallel_map_concurrency` | `number` | `3` | Max concurrent map items |
| `context_rot.enabled` | `boolean` | `false` | Enable context rot detection |
| `context_rot.check_interval` | `number` | `5` | Check every N operations |
| `context_rot.warning_threshold` | `number` | `0.5` | Score threshold for warning |
| `cache.enabled` | `boolean` | `true` | Enable sibling cache reads |
| `cache.ttl_hours` | `number` | `24` | Cache entry time-to-live |
| `benchmark_datasets_dir` | `string` | `".sisyphus/rlm-benchmarks"` | Directory for benchmark datasets |
