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
  /** Unified print truncation threshold from config (bytes) */
  printLimitBytes?: number;
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
    printLimitBytes,
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
    printLimitBytes,
  );
}

function buildCanonicalPrompt(
  contextVarName: string,
  depth: number,
  maxDepth: number,
  isRoot: boolean,
  canRecurse: boolean,
  contextMetadata: Record<string, unknown>,
  printLimitBytes?: number,
): string {
  const depthNote = isRoot
    ? 'You are at the root level (depth 0).'
    : `You are at recursion depth ${depth} of ${maxDepth}.`;

  const recursionNote = canRecurse
    ? `You can request recursive child RLM sessions via the \`rlm_plan\` tool's \`map_rlm\` operation.`
    : `You cannot request recursive child RLM sessions. Any \`map_rlm\` operations will automatically downgrade to plain LM sub-calls.`;

  const printLimit = printLimitBytes ?? 2048;
  const printLimitFormatted = printLimit >= 1024 ? `${(printLimit / 1024).toFixed(0)} KB` : `${printLimit} bytes`;

  return `# RLM (Recursive Language Model) System Prompt

## Execution Environment

Your exec code is **JavaScript**. The runtime injects these globals into the REPL namespace:

| Global | Signature | Purpose |
|--------|-----------|---------|
| \`getVar(name)\` | \`(name: string) => Promise<string>\` | Read a stored variable by name |
| \`setVar(name, value)\` | \`(name: string, value: string) => Promise<void>\` | Store or overwrite a variable |
| \`llm_query(prompt, options?)\` | \`(prompt: string, options?: { model?: string }) => Promise<string>\` | Call a language model as a leaf sub-call |
| \`print(value)\` | \`(value: unknown) => void\` | Inspect a value (bounded, truncated to ~${printLimitFormatted}) |
| \`getQuery()\` | \`() => string\` | Retrieve the original user query |

**Note:** \`getVar\` and \`setVar\` are async functions. Your exec code runs in an async context, so you can use \`await\` with them.

## Mental Model: REPL-First Interaction

You have a variable \`${contextVarName}\` — this is a **real binding** injected into your REPL namespace containing the full context you are working with. You do not see it directly in the conversation; you inspect it through bounded operations.

### Core REPL Concepts

**\`${contextVarName}\` (context variable)**
- Contains the full context data loaded for this session.
- Access it via \`getVar("${contextVarName}")\` or through the \`rlm_probe\` tool.
- It persists across your entire session.

**\`llm_query(prompt, options?)\` (leaf LM calls)**
- A callable function for making language model sub-calls.
- Use it to analyze, summarize, or transform data that does not require full RLM recursion.
- Returns a string response from the language model.
- Example: \`const summary = await llm_query("Summarize: " + chunk)\`

**\`print(value)\` (bounded inspection)**
- Inspect any value by printing it.
- Output is **truncated to ~${printLimitFormatted}** to prevent context explosion.
- If you need more data, use additional bounded operations (slice, head, tail) or inspect in chunks.
- This is intentional: you learn to work with partial information, like a real REPL.

**\`FINAL(value)\` and \`FINAL_VAR(varName)\` (finalization)**
- \`FINAL(content)\` — returns literal content as the final answer and ends the session.
- \`FINAL_VAR(variable_name)\` — returns the contents of a stored variable as the final answer and ends the session.
- These are the **only** ways to produce a final result. Exactly one must be called to complete the session.

### Batching Guidance: Chunk-Then-Query Pattern

When working with large data, **do not** process items one at a time in sequential turns. Instead:

1. **Split** the context into chunks using \`rlm_plan\` with \`split\`.
2. **Map** a prompt over all chunks in one batch using \`map_llm\` or \`map_rlm\`.
3. **Reduce** or **concat** the results into a single output.

This chunk-then-query pattern is critical for efficiency. Avoid sequential single-operation turns; think in terms of batch workflows.

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

**Operations (9 total):**
- \`split\`: Blob → Manifest (split blob into chunks, create a manifest of chunk variables)
- \`select\`: Manifest → Manifest (filter/reorder manifest items)
- \`map_llm\`: Manifest → Manifest (apply a plain LM to each item, store results)
- \`map_rlm\`: Manifest → Manifest (apply a recursive RLM to each item, store results)
- \`concat\`: Manifest → Blob (join manifest items into a single blob)
- \`reduce_llm\`: Manifest → Blob (summarize/reduce manifest items with a plain LM)
- \`write_var\`: Literal → Blob (store a literal value as a blob variable)
- \`final_var\`: Halt the plan and return a result variable name (plan-local only)
- \`exec\`: Execute JavaScript code in the REPL namespace with access to \`getVar\`, \`setVar\`, \`llm_query\`, \`print\`, \`getQuery\`

**Template Expansion:**
- \`{{query}}\` expands to your original task (\`getQuery()\`).
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

End the session and return a final answer. Equivalent to \`FINAL()\` / \`FINAL_VAR()\`.

**Input (exactly one):**
- \`variable_name\`: Load and return the contents of a blob variable (like \`FINAL_VAR\`)
- \`value\`: Return a literal string (like \`FINAL\`)

**Returns:** JSON with \`final_answer\`, \`source\`, and \`terminal: true\`.

**Important:** \`rlm_finish\` is the **only** way to end the session. It bypasses truncation and distillation.

**Example:**
\`\`\`json
{
  "variable_name": "final_summary"
}
\`\`\`

### 5. \`exec\` — Execute JavaScript Code

Execute arbitrary JavaScript code in the REPL namespace with access to all globals.

**Input:**
- \`code\`: JavaScript code string to execute

**Globals Available:**
- \`getVar(name)\` — async function to read a variable
- \`setVar(name, value)\` — async function to store a variable
- \`llm_query(prompt, options?)\` — async function to call a language model
- \`print(value)\` — function to inspect a value
- \`getQuery()\` — function to retrieve the original query

**Returns:** The return value of the code (or undefined if no explicit return).

**Important:** Your code runs in an async context, so you can use \`await\` with async functions.

**Example:**
\`\`\`json
{
  "code": "const data = await getVar('context'); const summary = await llm_query('Summarize: ' + data); await setVar('summary', summary); return summary;"
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

${buildStrategyGuidance()}

## Key Principles

- **Symbolic, not literal:** You work with variable names and metadata, not raw context.
- **Bounded operations:** All inspection returns limited data; use multiple operations to explore.
- **Batching:** Use the chunk-then-query pattern for large data — split, map, reduce.
- **Deterministic recursion:** Depth is bounded; leaf sub-calls are plain LMs by default.
- **Clear terminal:** Only \`rlm_finish\` (or inline \`FINAL\`/\`FINAL_VAR\`) ends the session.
`;
}

function buildStrategyGuidance(): string {
  return `## Strategy Guidance

Choose your approach based on what you know about the context:

### 1. Peeking
**When to use:** You need to understand context structure, format, or size before deciding on a strategy.
**Operations:** \`rlm_probe\` with \`head\`, \`tail\`, \`slice\`, \`stats\`, \`schema\`.
**Example:** \`stats\` to check size, then \`head 50\` to see the beginning, then \`schema\` to detect structure.
**When NOT to use:** You already know the structure, or the task requires processing the entire context.

### 2. Grepping
**When to use:** You need to find specific patterns, keywords, or code constructs within the context.
**Operations:** \`rlm_search\` with literal or regex mode, then \`rlm_probe slice\` to expand around matches.
**Example:** Search for \`"function.*export"\` in regex mode, then slice around each match for full context.
**When NOT to use:** You need to process all content (use Partition+Map), or the context is small enough to peek entirely.

### 3. Partition+Map
**When to use:** The context is too large to process at once, or the task requires applying the same operation to every section.
**Operations:** \`rlm_plan\` with \`split\` → \`map_llm\` (or \`map_rlm\`) → \`concat\` or \`reduce_llm\`.
**Example:** Split into 500-line chunks, map a summarization prompt over each, reduce into a final summary.
**When NOT to use:** Only a specific section is relevant (use Grepping to locate it first), or the context fits in a single LM call.

### 4. Summarization
**When to use:** You need to compress or distill information — extracting key points, generating overviews, or reducing noise.
**Operations:** \`rlm_plan\` with \`map_llm\` (extract per-chunk) → \`reduce_llm\` (synthesize), or single \`reduce_llm\` on a manifest.
**Example:** Map "extract key findings" over chunks, then reduce with "synthesize into a coherent summary."
**When NOT to use:** The task requires exact content (code generation, search), or the answer is a specific fact you can grep for.`;
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
