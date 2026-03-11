# src/features/rlm-context/ — Symbolic Context Store

**Generated:** 2026-03-05

## OVERVIEW

Disk-backed symbolic variable store for RLM (Recursive Language Model) sessions. Manages session lifecycle, blob and manifest variables, and persistent context storage. The store is the foundation of paper-faithful RLM: context is never directly visible to the model; instead, the model interacts with it symbolically through bounded operations.

## FILE STRUCTURE

| File | Purpose |
|------|---------|
| `types.ts` | Type contracts: `RlmSessionState`, `RlmBlobVariable`, `RlmManifestVariable`, `InitRlmSessionOptions` |
| `manager.ts` | `RlmContextManager` class: session init, variable creation, manifest resolution, deletion |
| `manager.test.ts` | Unit tests for store operations (blob/manifest round-trip, deletion, path safety) |
| `path-guards.ts` | Path safety: `resolveSessionDir()`, `resolveSessionFilePath()`, traversal rejection |
| `variable-input-parser.ts` | Input normalization: `parseBlobInput()`, `parseManifestInput()` |
| `index.ts` | Barrel export: `RlmContextManager`, types, path guards |
| `coordinator.ts` | `RlmSessionCoordinator` singleton: binds sessionID → RlmBinding |
| `turn-feedback.ts` | Metadata-only feedback: `shouldOffload()`, `offloadOutput()`, `applyFeedback()` |
| `error-codes.ts` | `RlmErrorCode` enum (23 codes) and `RlmError` class |
| `tracer.ts` | `RlmTracer` interface and span-based session tracing |

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

### `query` Persistence

The user's original query is stored in `RlmSessionState.query` and persists across the entire session. Used by plan operations for template expansion (`{{query}}`).

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

Tests in `manager.test.ts` cover:
- Session init and idempotency
- Blob creation from content and file
- Manifest creation and order preservation
- Variable lookup and listing
- Blob content reading
- Manifest resolution
- Session deletion (memory and disk)
- Path traversal rejection

## COORDINATOR PATTERN

The `RlmSessionCoordinator` is the single source of truth for active RLM sessions. It maps root chat session IDs to `RlmBinding` objects.

### RlmSessionCoordinator

```typescript
class RlmSessionCoordinator {
  bind(rootChatSessionId: string, binding: RlmBinding): void
  resolve(rootChatSessionId: string): RlmBinding | undefined
  unbind(rootChatSessionId: string): void
}

export const coordinator = new RlmSessionCoordinator()
```

### RlmBinding

```typescript
interface RlmBinding {
  manager: RlmContextManagerLike    // Context manager for variable operations
  rlmSessionId: string              // RLM session ID (may differ from chat session)
  depth: number                     // Current recursion depth (0 = root)
  query: string                     // Original user query
  contextVariableName: string       // Name of the pre-injected context variable
  trusted: boolean                  // Whether exec operations are permitted
}
```

All four tools resolve their binding via `coordinator.resolve(context.sessionID)`. Tools return `{ error: "session_not_found" }` when no binding exists.

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

RLM uses a typed error taxonomy with 23 error codes defined in `RlmErrorCode`.

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
| `INTERNAL_ERROR` | An internal error occurred. |

**Usage:**
```typescript
import { rlmError, RlmErrorCode, toErrorJson } from "./error-codes"

// Create error
const err = rlmError(RlmErrorCode.VARIABLE_NOT_FOUND, { name: "missing_var" })

// Serialize for tool response
return JSON.stringify(toErrorJson(err))
```

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
  startSpan(chatSessionId, rlmSessionId, operation, parentSpanId?): RlmSpan
  endSpan(spanId, status, error?): void
  getSpans(rlmSessionId): RlmSpan[]
  getTrace(rootSpanId): SpanTreeNode | undefined
}
```

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
| `tracing.enabled` | `boolean` | `false` | Enable session tracing |
| `tracing.output` | `string` | `"log"` | Trace output: `log`, `file`, or `both` |
| `tracing.spans_dir` | `string` | `".sisyphus/rlm-traces"` | Directory for trace files |
