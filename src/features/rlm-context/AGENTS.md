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
