# src/tools/rlm/ — RLM Public Tools and Internals

**Generated:** 2026-03-12

## OVERVIEW

Four public RLM tools (`rlm_probe`, `rlm_search`, `rlm_plan`, `rlm_finish`) plus internal helpers for session initialization, system prompt building, recursive child execution, parallel map execution, AST-aware code splitting, and sibling caching. The tools expose a REPL-first mental model where context is symbolic and interaction is bounded.

## FILE STRUCTURE

| File | Purpose |
|------|---------|
| `types.ts` | Zod schemas for all tool inputs and internal helpers |
| `init-session.ts` | `initRlmSession()` helper: pre-turn session setup with context offload |
| `system-prompt.ts` | `buildRlmSystemPrompt()`: REPL-first prompt builder |
| `parser.ts` | `parseFinalAnswer()`: compatibility parser for `FINAL()` / `FINAL_VAR()` |
| `probe-tool.ts` | `createRlmProbeTool()`: bounded inspection operations |
| `search-tool.ts` | `createRlmSearchTool()`: regex/literal search on blobs |
| `finish-tool.ts` | `createRlmFinishTool()`: session-terminal tool |
| `plan-executor.ts` | `executeRlmPlan()`: orchestrates 8-op plan execution |
| `exec-op.ts` | `executeExecOperation()`: trusted REPL execution for `exec` plan op |
| `repl-runtime.ts` | `createTrustedLocalRlmReplBackend()`: sandboxed exec with getVar/setVar/llm_query/print |
| `plan-basic-ops.ts` | `split`, `split_code`, `select`, `concat`, `write_var` operations |
| `plan-subcall-ops.ts` | `map_llm`, `map_rlm`, `reduce_llm` with child session handling |
| `subcall-runner.ts` | Sync sub-call execution with exponential backoff + jitter |
| `plan-utils.ts` | Helpers: session lookup, template expansion, error formatting |
| `plan-operation-runner.ts` | Dispatches plan ops with parallel/sequential routing |
| `progress-emitter.ts` | `createProgressEmitter()`: throttled progress + streaming events |
| `vm-sandbox.ts` | `createVmSandboxRlmReplBackend()`: defense-in-depth `node:vm` sandbox |
| `sub-rlm.ts` | `createSubRlm()`: recursive exec helper for `sub_rlm()` namespace function |
| `exec-namespace.ts` | `installExecNamespace()`: shared helper surface for trusted and VM backends |
| `parallel-executor.ts` | `executeParallelMapLlmOperation()`, `executeParallelMapRlmOperation()` |
| `parallel-map-shared.ts` | Shared parallel map utilities: chunked execution, ordered persistence |
| `split-strategies.ts` | `splitByAst()`: AST-aware code splitting for TypeScript, Python, Go |
| `content-bounds.ts` | `applyContentBounds()`: token/byte-bounded content truncation |
| `session-lock.ts` | `SessionLock`: per-session async FIFO lock for exec concurrency safety |
| `sibling-cache.ts` | `lookupSiblingCacheResult()`: fingerprint-based result caching |
| `benchmark/` | RLM benchmark harness, 4 core patterns, dataset loaders, evaluation runner |
| `tools.ts` | Factory functions: `createRlmProbeTool()`, `createRlmSearchTool()`, etc. |
| `index.ts` | Barrel export: all factories and helpers |

## PUBLIC TOOLS

### 1. `rlm_probe` — Bounded Inspection

**Factory:** `createRlmProbeTool(contextManager, options)`

**Operations (discriminated union):**

| Operation | Parameters | Returns |
|-----------|-----------|---------|
| `head` | `variable_name`, `lines?`, `max_bytes?`, `max_tokens?` | First N lines of blob |
| `tail` | `variable_name`, `lines?`, `max_bytes?`, `max_tokens?` | Last N lines of blob |
| `slice` | `variable_name`, `start`, `end`, `max_bytes?`, `max_tokens?` | Lines M to N of blob |
| `stats` | `variable_name` | Metadata (size, line count) for blob or manifest |
| `schema` | `variable_name` | Best-effort structure detection for blob |
| `list_vars` | (none) | All variables in session with metadata |
| `inspect_ref` | `ref` | Bounded preview of a hidden (offloaded) variable |

**Behavior:**
- Content-returning operations bounded by `probe_max_lines` config (default 200)
- Optional `max_bytes` and `max_tokens` apply after line-based slicing (most restrictive wins)
- When token/byte bounds are applied, response includes `returned_bytes` and `returned_tokens`
- `list_vars` returns metadata only, no content
- Manifest `stats` returns item count and total size
- All responses are JSON

**Example:**
```json
{
  "operation": "head",
  "variable_name": "context",
  "lines": 50
}
```

### 2. `rlm_search` — Regex/Keyword Search

**Factory:** `createRlmSearchTool(contextManager, options)`

**Input:**
```typescript
{
  variable_name: string
  pattern: string
  mode: 'literal' | 'regex'  // default: 'literal'
  max_results?: number
}
```

**Behavior:**
- Searches blob variables only; manifest search returns explicit error JSON
- Literal mode: substring search
- Regex mode: line-by-line matching with safety guards (timeout, backtracking limits)
- Returns bounded match results with line numbers and surrounding context
- Regex timeout/guard failure returns error JSON

**Example:**
```json
{
  "variable_name": "context",
  "pattern": "function.*async",
  "mode": "regex",
  "max_results": 10
}
```

### 3. `rlm_plan` — Manifest-Aware Plan Executor

**Factory:** `createRlmPlanTool(contextManager, options)`

**Input:**
```typescript
{
  operations: Array<
    | { op: 'split', variable_name, chunk_size, output_variable }
    | { op: 'split_code', variable_name, language, granularity?, output_variable }
    | { op: 'select', variable_name, indices?, filter?, output_variable }
    | { op: 'map_llm', variable_name, prompt, output_variable }
    | { op: 'map_rlm', variable_name, prompt, output_variable }
    | { op: 'concat', variable_name, output_variable }
    | { op: 'reduce_llm', variable_name, prompt, output_variable }
    | { op: 'write_var', variable_name, output_variable }
    | { op: 'exec', code, output_variable? }
    | { op: 'final_var', variable_name }
  >
}
```

**Operations:**

| Op | Input | Output | Semantics |
|----|-------|--------|-----------|
| `split` | blob | manifest | Chunk blob into N-line pieces, create manifest |
| `split_code` | blob | manifest | AST-aware split by function/class/block boundaries |
| `select` | manifest | manifest | Filter/reorder manifest items by indices or filter expression |
| `map_llm` | manifest | manifest | Apply LM prompt to each blob item, collect results |
| `map_rlm` | manifest | manifest | Apply RLM session to each blob item (or downgrade to `map_llm` if depth limit reached) |
| `concat` | manifest | blob | Join all manifest items into single blob |
| `reduce_llm` | manifest | blob | Apply LM reduction prompt to manifest, return single blob |
| `write_var` | literal | blob | Write literal string to new blob variable |
| `exec` | code string | blob (optional) | Execute sandboxed code with getVar/setVar/llm_query/print |
| `final_var` | variable_name | — | Plan-local halt; return variable name (not terminal) |

**Execution Rules:**
- `map_llm`/`map_rlm` execute in parallel when `parallel_map_concurrency > 1` (default: 3)
- Parallel map uses `Promise.allSettled` with bounded concurrency; results ordered by original index
- Fallback to sequential when `parallel_map_concurrency: 1`
- Max 50 operations per plan (configurable via `plan_max_operations`)
- `{{query}}` expands from persisted `session.taskPrompt`; `{{rootQuery}}` from `session.rootQuery`
- `{{item}}` expands from current blob item content (in map operations)
- Stops on first error or `final_var`

**Return Shape:**
```json
{
  "terminal": false,
  "halted": false,
  "executed_ops": 8,
  "operation_results": [...]
}
```

Or on `final_var`:
```json
{
  "terminal": false,
  "halted": true,
  "final_variable": "result",
  "executed_ops": 5,
  "operation_results": [...],
  "budget": { "subcall_count": 3, "output_bytes": 4096, "wall_time_ms": 1200 }
}
```

**Depth Semantics:**
- `map_rlm` checks if `session.depth + 1 >= session.maxDepth`
- If true: downgrades to `map_llm` (plain LM sub-call)
- If false: creates child RLM session with `initRlmSession()` before child's first model turn

**Child Session Lifecycle:**
1. Create child session ID
2. Call `initRlmSession()` with child query + item content
3. Build child system prompt from metadata only
4. Launch child RLM session
5. Extract result from child's `rlm_finish` or `FINAL()/FINAL_VAR()` parse
6. Clean up: delete child session, remove from session tracking

### 4. `rlm_finish` — Session-Terminal Tool

**Factory:** `createRlmFinishTool(contextManager)`

**Input (XOR):**
```typescript
{
  variable_name?: string  // Load blob content
  value?: string          // Literal string
}
```

**Behavior:**
- Exactly one of `variable_name` or `value` required
- If `variable_name`: loads blob content, rejects manifest
- If `value`: returns literal string
- Returns JSON with `terminal: true` flag

**Return Shape:**
```json
{
  "final_answer": "...",
  "source": "variable|literal",
  "terminal": true
}
```

**Semantics:**
- Only `rlm_finish` sets `terminal: true`
- `final_var` in plan returns `terminal: false`
- Bypasses truncation and distillation hooks

## INTERNAL HELPERS

### `initRlmSession(contextManager, input)`

**Purpose:** Pre-turn session initialization. Called by `/rlm` command and recursive child setup.

**Input:**
```typescript
{
  sessionId: string
  query: string
  content?: string          // XOR with file_path
  file_path?: string        // XOR with content
  depth?: number            // default: 0
  parentSessionId?: string
  maxDepth: number
  contextDir: string
  shouldDistill?: boolean   // default: false
}
```

**Behavior:**
- Validates XOR: exactly one of `content` or `file_path`
- Requires `query`
- Initializes session if absent
- Creates root `context` blob variable before any model turn
- Returns metadata-only result (no raw content)

**Return Shape:**
```typescript
{
  sessionId: string
  depth: number
  maxDepth: number
  rootQuery: string           // Original user query (propagated to children)
  taskPrompt: string          // Per-session task prompt (may differ in children)
  shouldDistill: boolean
  parentSessionId?: string
  contextMetadata: {
    contextVariableName: string
    contextSize: number
    contextType: string
    lineCount: number
  }
}
```

### `buildRlmSystemPrompt(options)`

**Purpose:** REPL-first system prompt builder.

**Input:**
```typescript
{
  depth: number
  maxDepth: number
  contextMetadata?: {
    contextVariableName?: string
    contextSize?: number
    contextType?: string
  }
  mode: 'canonical' | 'keyword-alias'
}
```

**Behavior:**
- `canonical` mode: Full REPL mental model + tool mapping
- `keyword-alias` mode: Lightweight prompt for already-present context
- Explains `context`, `llm_query`, `print()`, truncated outputs, `FINAL/FINAL_VAR`
- Maps to OMO tools: `rlm_probe`, `rlm_search`, `rlm_plan`, `rlm_finish`
- Explicitly distinguishes `final_var` (plan-local) from `rlm_finish` (terminal)
- Includes depth and recursion downgrade semantics

### `parseFinalAnswer(text)`

**Purpose:** Compatibility parser for paper-style child outputs.

**Input:** Raw child model output text

**Return:**
```typescript
{
  type: 'final'
  content: string
} | {
  type: 'final_var'
  variableName: string
} | null
```

**Behavior:**
- Checks `FINAL_VAR(...)` before `FINAL(...)`
- Start-of-line enforcement
- Greedy multiline capture for `FINAL(...)`
- Empty `FINAL()` allowed
- Returns `null` if neither pattern found

**Used by:** `map_rlm` and `reduce_llm` for child result extraction

### `createProgressEmitter(config, logger)`

**Purpose:** Throttled progress events for plan execution.

**Input:**
```typescript
{
  throttleMs: number
}
```

**Behavior:**
- Emits `rlm:plan:progress` events before and after each operation
- Throttles "before" events to `throttleMs` (default 200ms)
- Always emits "after" events and first/last "before" events
- Includes `opIndex`, `opCount`, `opType`, `phase`, and `durationMs` (for "after")

**Streaming Results (Phase 4):**
- `emitStreamingResult()` sends partial plan results as `rlm:plan:streaming` events
- Independent throttle state (`streaming_throttle_ms`, default 100ms)
- Always emits on `percent_complete === 100`
- Large results truncated to 200-char preview + byteSize (respects offload threshold)
- Config: `progress.streaming_enabled` (default `true`), `progress.streaming_throttle_ms` (default `100`)

### `createVmSandboxRlmReplBackend(deps?)`

**Purpose:** Defense-in-depth `node:vm` sandbox for `exec` operations.

**Architecture:**
- Uses `node:vm` module for execution isolation
- **Null-prototype namespace:** Prevents prototype pollution attacks
- **Blocked globals:** Explicitly blocks `Buffer`, `process`, `require`, `__dirname`, `__filename`
- **Code generation disabled:** `strings: false`, `wasm: false`
- **Timeout protection:** Mandatory `timeout` for `runInContext`
- **Fallback mode:** Uses `with(scope)` proxy if `node:vm` is unavailable (less secure)

**Security Note:** Node.js explicitly warns that `node:vm` is not a security mechanism. This sandbox provides defense-in-depth but should not be the sole security layer for untrusted code.

## PLAN-OP SEMANTICS

### `final_var` vs `rlm_finish`

| Aspect | `final_var` | `rlm_finish` |
|--------|-----------|------------|
| Scope | Plan-local | Session-terminal |
| Return `terminal` | `false` | `true` |
| Halts | Current plan | Entire session |
| Can be followed by | Nothing (plan stops) | Nothing (session ends) |
| Used in | `rlm_plan` operations | Direct tool call |

**Example:**
```json
{
  "operations": [
    { "op": "split", "variable_name": "context", "chunk_size": 100, "output_variable": "chunks" },
    { "op": "map_llm", "variable_name": "chunks", "prompt": "summarize", "output_variable": "summaries" },
    { "op": "final_var", "variable_name": "summaries" }
  ]
}
```

Returns:
```json
{
  "terminal": false,
  "halted": true,
  "final_variable": "summaries",
  "executed_ops": 3,
  "operation_results": [...]
}
```

Then the model calls `rlm_finish` with the summary variable to actually end the session.

### Depth Semantics

**Root session (depth=0, maxDepth=1):**
- `map_rlm` downgrades to `map_llm` (no recursion allowed)

**Root session (depth=0, maxDepth=2):**
- `map_rlm` creates child sessions at depth=1
- Child's `map_rlm` downgrades to `map_llm` (depth 1 + 1 >= maxDepth 2)

**Downgrade behavior:**
- Automatic, no error
- Child receives plain LM prompt instead of RLM system prompt
- Result extraction uses `FINAL()/FINAL_VAR()` parser only

## TERMINAL BOUNDARY

### What Ends a Session

Only `rlm_finish` with `terminal: true` ends the session.

### What Does NOT End a Session

- `final_var` in plan (returns `terminal: false`)
- Any other tool output
- Model reaching max tokens

### Truncation and Distillation Bypass

`rlm_finish` output bypasses:
- `tool-output-truncator` hook
- RLM output distiller hook

This ensures the final answer is never truncated.

## INTEGRATION POINTS

- **`/rlm` command**: Calls `initRlmSession()` before first model turn
- **Keyword detector**: Injects `buildRlmSystemPrompt()` with `mode: 'keyword-alias'`
- **Session cleanup**: Calls `contextManager.deleteSession()` on `session.deleted` event
- **Plan child execution**: Uses `initRlmSession()` and `buildRlmSystemPrompt()` for child setup
- **Tool registry**: All four public tools registered in `src/plugin/tool-registry.ts`

## TESTING

Tests cover:
- Probe operations: head, tail, slice, stats, schema, list_vars, token/byte bounds
- Search: literal and regex modes, bounded results, manifest rejection
- Plan: all 10 operations, manifest order preservation, depth downgrade, parallel map
- Finish: variable and literal paths, XOR validation, manifest rejection
- Init helper: session creation, context blob creation, metadata return
- System prompt: REPL-first framing, depth/recursion notes, tool mapping
- Parser: `FINAL()` and `FINAL_VAR()` precedence, multiline capture
- Sub-RLM: downgrade behavior, wall-time inheritance, subcall_limit, cleanup
- Parallel executor: ordered output, concurrency bounds, aggregated error reporting
- Split strategies: AST splitting for TS/Python/Go, fallback behavior
- Session lock: same-session serialization, different-session parallelism
- Sibling cache: key generation, TTL expiry, fingerprint completeness
- Content bounds: max_bytes truncation, max_tokens truncation, combined bounds
- Benchmarks: dataset loaders, evaluation runner, smoke/full modes
- Integration: full probe → search → exec → finish flow, metadata-only feedback, trusted mode, FINAL/FINAL_VAR finalization

## ALGORITHM 1 CONTRACTS

These contracts are derived from the RLM paper's Algorithm 1 and govern all tool behavior:

### Session Authority

One coordinator per root chat session. The `RlmSessionCoordinator` singleton maps `rootChatSessionId → RlmBinding`. All four tools resolve their binding via `coordinator.resolve(context.sessionID)`. If no binding exists, tools return `{ error: "session_not_found" }`.

### Metadata-Only Feedback

Tool outputs exceeding `feedback.output_threshold_bytes` (default: 2048) are offloaded to hidden variables (`__hidden_*` prefix). The model receives only metadata (ref, preview, byte size) — never raw content exceeding the threshold. This keeps the conversation history bounded.

**Exception:** `rlm_finish` output bypasses offloading entirely. The final answer is always returned in full.

### Variable-Centric Interaction

Data lives in variables (blobs and manifests). Tools operate on references (variable names), not raw content. The model inspects data through bounded operations (`head`, `tail`, `slice`, `stats`, `inspect_ref`) and transforms it through plan operations (`split`, `map_llm`, `exec`, etc.).

### Finalization

Two finalization paths:

| Path | Mechanism | Scope |
|------|-----------|-------|
| `rlm_finish` tool | Direct tool call with `variable_name` or `value` | Session-terminal (`terminal: true`) |
| `FINAL(value)` / `FINAL_VAR(varname)` | Inline tags in model text, consumed by `final-consumer` hook | Session-terminal (unbinds coordinator) |

Both paths return the complete value to the user. `FINAL_VAR(varname)` resolves the variable before returning.

## APPENDIX C CONTRACTS

These contracts define the model-facing REPL namespace injected into `exec` operations:

| Symbol | Type | Description |
|--------|------|-------------|
| `context` | `string` | Pre-injected from the binding's context variable on first exec |
| `llm_query(prompt, options?)` | `async (string, {title?, max_tokens?}) => string` | Callable LM function for leaf queries via sync subcall |
| `sub_rlm(query, contextOrVar, options?)` | `async (string, string, {title?}) => string` | Recursive RLM subcall; downgrades to LM at depth limit |
| `print(value)` | `(unknown) => void` | Bounded output capture; offloaded if exceeding `print_limit_bytes` |
| `getVar(name)` | `async (string) => string` | Read blob variable content by name |
| `setVar(name, value)` | `async (string, string) => void` | Create or overwrite blob variable |
| `getQuery()` | `() => string` | Access the per-session task prompt |
| `getRootQuery()` | `() => string` | Access the original root user query |

**Trusted mode:** Exec requires `binding.trusted === true` when `exec.trusted_only` is enabled (default). Untrusted bindings receive an error: `"exec requires trusted mode"`.

**Namespace persistence:** Variables set via the `context` global and bare assignments persist across exec calls within the same session.

**Concurrency safety:** Per-session `SessionLock` serializes exec calls within the same RLM session while different sessions run in parallel. Both trusted and VM backends acquire the lock around the entire `execute()` call.

### `sub_rlm()` Semantics

The `sub_rlm(query, contextOrVar, options?)` exec helper enables recursive RLM calls from within `exec` operations:

- **Context resolution:** If `contextOrVar` matches an existing blob variable name, its content is used; otherwise the string is treated as literal context
- **Depth check:** When `depth + 1 >= maxDepth`, downgrades to a plain LM subcall with inline context (no RLM tools)
- **Recursive path:** Creates a child RLM session via `initRlmSession()`, binds it through the coordinator, runs the subcall, then resolves output via `rlm_finish`/`FINAL()`/`FINAL_VAR()`
- **Budget enforcement:** Respects `subcall_limit` config; inherits remaining wall-time from root budget
- **Cleanup:** Always unbinds child coordinator, deletes child session, and cleans up subcall tracking in `finally`

### `split_code` Operation

AST-aware code splitting using ast-grep for TypeScript, Python, and Go:

- **Languages:** `typescript`, `python`, `go`
- **Granularities:** `function` (functions/methods), `class` (classes/types), `block` (both)
- **Filtering:** Top-level declarations only (`start.column === 0`), sorted by byte offset, overlapping spans deduplicated
- **Fallback:** Falls back to naive 4000-character chunking on AST errors or zero valid matches

### Sibling Cache

Fingerprint-based result caching for sibling RLM runs:

- **Key parts:** `session_id`, `root_query`, `model`, `provider`, `version`, `temperature`, `system_prompt_hash`
- **Lookup:** Skipped when model/provider/temperature are missing (avoids accidental hits)
- **Storage:** `.sisyphus/rlm-cache/siblings/{hash}.json`
- **TTL:** Configurable via `cache.ttl_hours` (default 24h); `cache.enabled` can disable reads entirely

### Benchmark Patterns

The `src/tools/rlm/benchmark/` directory contains a harness and 4 core patterns for verifying RLM performance and correctness:

| Pattern | Purpose |
|---------|---------|
| **Split-Map-Reduce** | Verifies basic manifest flow: split blob → map LLM → reduce LLM |
| **Recursive Decomposition** | Verifies `map_rlm` recursion, depth limits, and child session cleanup |
| **Variable Pipeline** | Verifies complex multi-tool flows: `exec` → `probe` → `exec` → `finish` |
| **Error Recovery** | Verifies error taxonomy and graceful failure on invalid inputs/patterns |

**Dataset Loaders (Phase 4):**

| Dataset | Items | Purpose |
|---------|-------|---------|
| **browsecomp** | 15 | Web navigation queries: fact-retrieval, code-navigation, documentation |
| **oolong** | 12 | Long-context reasoning: character-tracking, numerical-reasoning, state-tracking, etc. |

- `loadDataset(name, mode)`: loads synthetic datasets with `smoke` (3 items) or `full` mode
- `listDatasets()`: returns available dataset names
- Datasets are in-memory constants with Zod-validated `DatasetItem` schema

**Evaluation Runner (Phase 4):**

- `runEvaluation(config)`: runs dataset evaluation with smoke (mocked) or full (real subcall) modes
- Metrics: exact match accuracy, fuzzy match accuracy, token efficiency, average depth/tokens/wall time
- Fuzzy matching: normalized-string containment + expected-token overlap (>= 0.6 threshold)

Run benchmarks via:
```bash
bun test src/tools/rlm/benchmark/harness.test.ts
bun test src/tools/rlm/benchmark/evaluation.test.ts
```

## TESTING GUIDELINES

### Mocking Patterns

**InMemoryRlmManager** (`plan-tool.test-helpers.ts`): In-memory implementation of `RlmContextManagerLike`. Use for all unit and integration tests that don't need disk I/O.

```typescript
const manager = new InMemoryRlmManager()
manager.seedSession(createSession(sessionId, query, depth, maxDepth))
manager.createBlobVariable(sessionId, { name: "context", content: "..." })
bindTestCoordinator(sessionId, manager, { trusted: true })
```

**Mock REPL backend:** Inject via `deps.replBackend` on `createRlmPlanTool()` to bypass real code execution:

```typescript
const mockBackend: RlmReplBackend = { execute: async () => "mock output" }
createRlmPlanTool({ ..., deps: { replBackend: mockBackend } })
```

**Mock subcalls:** Inject `runSyncSubcall` and `cleanupSyncSubcallSession` to avoid real LM calls:

```typescript
createTrustedLocalRlmReplBackend({
  runSyncSubcall: async (input) => ({ ok: true, sessionID: "child-1", textOutput: "mock", messages: [] }),
  cleanupSyncSubcallSession: async () => {},
})
```

### Key Verification Points

- **Offloading:** Large outputs (>2KB) become `{ ref, variableName, preview }` — never raw content
- **Finish bypass:** `rlm_finish` output is never offloaded
- **Trusted mode:** `exec` with `trusted_only=true` + untrusted binding → error
- **FINAL tags:** `consumeFinalFromMessage` extracts value and unbinds coordinator
- **Cleanup:** Always `unbindTestCoordinator` and `clearRlmReplNamespace` in `afterEach`
