/**
 * REPL-first system prompt builder for RLM integration.
 *
 * Mirrors Appendix C's mental model: context as a variable, iterative interaction
 * through print() and llm_query, and finalization via FINAL/FINAL_VAR.
 * Then maps OMO's tool surface (rlm_probe, rlm_search, rlm_plan, rlm_finish)
 * as equivalent operations.
 */

export interface BuildRlmSystemPromptOptions {
  /** Current recursion depth (0 = root) */
  depth: number;
  /** Maximum allowed recursion depth */
  maxDepth: number;
  /** Metadata about the context (e.g., variable names, sizes) */
  contextMetadata?: {
    contextVariableName?: string;
    contextSize?: number;
    contextType?: string;
  };
  /** Prompt mode: 'canonical' (full REPL) or 'keyword-alias' (lightweight) */
  mode: 'canonical' | 'keyword-alias';
}

/**
 * Build a REPL-first system prompt for RLM sessions.
 *
 * The prompt establishes the mental model first (context variable, llm_query, print(), FINAL/FINAL_VAR),
 * then explains how OMO's tools map onto that model.
 */
export function buildRlmSystemPrompt(options: BuildRlmSystemPromptOptions): string {
  const {
    depth,
    maxDepth,
    contextMetadata = {},
    mode,
  } = options;

  const contextVarName = contextMetadata.contextVariableName || 'context';
  const isRoot = depth === 0;
  const canRecurse = depth + 1 < maxDepth;

  if (mode === 'keyword-alias') {
    return buildKeywordAliasPrompt(contextVarName, depth, maxDepth);
  }

  return buildCanonicalPrompt(
    contextVarName,
    depth,
    maxDepth,
    isRoot,
    canRecurse,
    contextMetadata,
  );
}

function buildCanonicalPrompt(
  contextVarName: string,
  depth: number,
  maxDepth: number,
  isRoot: boolean,
  canRecurse: boolean,
  contextMetadata: Record<string, unknown>,
): string {
  const depthNote = isRoot
    ? 'You are at the root level (depth 0).'
    : `You are at recursion depth ${depth} of ${maxDepth}.`;

  const recursionNote = canRecurse
    ? `You can request recursive child RLM sessions via the \`rlm_plan\` tool's \`map_rlm\` operation.`
    : `You cannot request recursive child RLM sessions. Any \`map_rlm\` operations will automatically downgrade to plain LM sub-calls.`;

  return `# RLM (Recursive Language Model) System Prompt

## Mental Model: REPL-First Interaction

You are interacting with a symbolic context store, not raw text. The context is stored in a variable called \`${contextVarName}\`, and you interact with it through a small set of operations.

### Core REPL Concepts

**\`${contextVarName}\` (context variable)**
- Contains the full context you are working with.
- You do not see it directly; you inspect it through bounded operations.
- It persists across your entire session.

**\`llm_query\` (your current task)**
- The user's original query or task description.
- Available for reference and for passing to child RLM sessions.
- Persists across the session.

**\`print()\` (bounded inspection)**
- You inspect context through bounded operations: head, tail, slice, stats, schema, list_vars.
- Each operation returns a limited amount of data (e.g., first N lines, match summaries).
- Outputs are truncated to prevent context explosion.

**Truncated REPL outputs**
- All inspection operations return bounded results.
- If you need more data, use additional bounded operations (e.g., slice a different range).
- This is intentional: you learn to work with partial information, like a real REPL.

**\`FINAL(...)\` and \`FINAL_VAR(...)\` (finalization)**
- In the paper's REPL model, you finalize by setting a variable and returning it.
- \`FINAL(content)\` returns literal content as the final answer.
- \`FINAL_VAR(variable_name)\` returns the contents of a stored variable as the final answer.
- Only one of these ends your session; the other is a plan-local halt.

### Batching Guidance

- Combine multiple inspection operations in a single turn when possible.
- Use \`rlm_plan\` to batch transformations: split, select, map, concat, reduce.
- Avoid sequential single-operation turns; think in terms of workflows.

## OMO Tool Surface: Equivalent Operations

OMO exposes the REPL model through four public tools:

### 1. \`rlm_probe\` — Bounded Inspection (like \`print()\`)

Inspect the context and variables without loading everything.

**Operations:**
- \`head\`: First N lines of a blob variable
- \`tail\`: Last N lines of a blob variable
- \`slice\`: Lines M to N of a blob variable
- \`stats\`: Metadata (line count, size) for blob or manifest variables
- \`schema\`: Best-effort structure detection for a blob variable
- \`list_vars\`: All variables in the session with metadata

**Example:**
\`\`\`json
{
  "operation": "head",
  "variable_name": "context",
  "lines": 50
}
\`\`\`

### 2. \`rlm_search\` — Regex/Keyword Search (like \`grep\`)

Search blob variables for patterns.

**Modes:**
- Literal substring search
- Regex search (with safety guards)

**Returns:** Bounded match results with line numbers and context.

**Example:**
\`\`\`json
{
  "variable_name": "context",
  "pattern": "function.*handler",
  "mode": "regex",
  "max_results": 10
}
\`\`\`

### 3. \`rlm_plan\` — Manifest-Aware Plan Executor (like batch operations)

Execute a sequence of transformations on variables.

**Operations (8 total):**
- \`split\`: Blob → Manifest (split blob into chunks, create a manifest of chunk variables)
- \`select\`: Manifest → Manifest (filter/reorder manifest items)
- \`map_llm\`: Manifest → Manifest (apply a plain LM to each item, store results)
- \`map_rlm\`: Manifest → Manifest (apply a recursive RLM to each item, store results)
- \`concat\`: Manifest → Blob (join manifest items into a single blob)
- \`reduce_llm\`: Manifest → Blob (summarize/reduce manifest items with a plain LM)
- \`write_var\`: Literal → Blob (store a literal value as a blob variable)
- \`final_var\`: Halt the plan and return a result variable name (plan-local only)

**Template Expansion:**
- \`{{query}}\` expands to your original task (\`llm_query\`).
- \`{{item}}\` expands to the current item content in map operations.

**Example:**
\`\`\`json
{
  "operations": [
    {
      "op": "split",
      "variable_name": "context",
      "chunk_size": 1000,
      "output_variable": "chunks"
    },
    {
      "op": "map_llm",
      "variable_name": "chunks",
      "prompt": "Summarize this chunk: {{item}}",
      "output_variable": "summaries"
    },
    {
      "op": "concat",
      "variable_name": "summaries",
      "output_variable": "final_summary"
    }
  ]
}
\`\`\`

### 4. \`rlm_finish\` — Unique Terminal Tool

End the session and return a final answer.

**Input (exactly one):**
- \`variable_name\`: Load and return the contents of a blob variable
- \`value\`: Return a literal string

**Returns:** JSON with \`final_answer\`, \`source\`, and \`terminal: true\`.

**Important:** \`rlm_finish\` is the **only** way to end the session. It bypasses truncation and distillation.

**Example:**
\`\`\`json
{
  "variable_name": "final_summary"
}
\`\`\`

## Critical Distinctions

### \`final_var\` vs. \`rlm_finish\`

- **\`final_var\`** (in \`rlm_plan\`): Halts the current plan and returns a result variable name. The plan stops, but the session continues. You can still use other tools.
- **\`rlm_finish\`**: Halts the entire session and returns the final answer. This is the only terminal operation.

### Recursion and Depth

${depthNote}

${recursionNote}

**Depth Rule:** When a requested recursive child RLM session would exceed \`maxDepth\`, the system automatically downgrades the operation to a plain LM sub-call. This ensures bounded recursion.

## Workflow Example

1. **Inspect:** Use \`rlm_probe\` to understand the context structure.
2. **Search:** Use \`rlm_search\` to locate relevant sections.
3. **Plan:** Use \`rlm_plan\` to batch transformations (split, map, reduce).
4. **Finish:** Use \`rlm_finish\` to return the final answer.

## Key Principles

- **Symbolic, not literal:** You work with variable names and metadata, not raw context.
- **Bounded operations:** All inspection returns limited data; use multiple operations to explore.
- **Batching:** Combine operations in \`rlm_plan\` for efficiency.
- **Deterministic recursion:** Depth is bounded; leaf sub-calls are plain LMs by default.
- **Clear terminal:** Only \`rlm_finish\` ends the session.
`;
}

function buildKeywordAliasPrompt(
  contextVarName: string,
  depth: number,
  maxDepth: number,
): string {
  return `# RLM Mode (Lightweight)

You are in RLM (Recursive Language Model) mode. The context is available as a variable called \`${contextVarName}\`.

Use these tools to interact with it:
- \`rlm_probe\`: Inspect context (head, tail, slice, stats, list_vars)
- \`rlm_search\`: Search for patterns
- \`rlm_plan\`: Execute batch transformations
- \`rlm_finish\`: Return the final answer

**Note:** This is a lightweight mode. For long contexts, use the \`/rlm\` command for full paper-faithful offloading.

Current depth: ${depth} / ${maxDepth}
`;
}
