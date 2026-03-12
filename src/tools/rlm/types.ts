import { z } from "zod"

const RlmProbeHeadSchema = z.object({
  operation: z.literal("head"),
  variable_name: z.string(),
  lines: z.number().int().min(1).optional(),
  max_bytes: z.number().int().min(1).optional(),
  max_tokens: z.number().int().min(1).optional(),
})

const RlmProbeTailSchema = z.object({
  operation: z.literal("tail"),
  variable_name: z.string(),
  lines: z.number().int().min(1).optional(),
  max_bytes: z.number().int().min(1).optional(),
  max_tokens: z.number().int().min(1).optional(),
})

const RlmProbeSliceSchema = z.object({
  operation: z.literal("slice"),
  variable_name: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  max_bytes: z.number().int().min(1).optional(),
  max_tokens: z.number().int().min(1).optional(),
})

const RlmProbeStatsSchema = z.object({
  operation: z.literal("stats"),
  variable_name: z.string(),
})

const RlmProbeSchemaOpSchema = z.object({
  operation: z.literal("schema"),
  variable_name: z.string(),
})

const RlmProbeInspectRefSchema = z.object({
  operation: z.literal("inspect_ref"),
  ref: z.string(),
})

const RlmProbeListVarsSchema = z.object({
  operation: z.literal("list_vars"),
})

export const RlmProbeInputSchema = z.discriminatedUnion("operation", [
  RlmProbeHeadSchema,
  RlmProbeTailSchema,
  RlmProbeSliceSchema,
  RlmProbeStatsSchema,
  RlmProbeSchemaOpSchema,
  RlmProbeInspectRefSchema,
  RlmProbeListVarsSchema,
])

export type RlmProbeInput = z.infer<typeof RlmProbeInputSchema>

export const RlmSearchInputSchema = z.object({
  variable_name: z.string(),
  pattern: z.string(),
  mode: z.enum(["literal", "regex"]).default("literal"),
  max_results: z.number().int().min(1).optional(),
})

export type RlmSearchInput = z.infer<typeof RlmSearchInputSchema>

const RlmPlanSplitOpSchema = z.object({
  op: z.literal("split"),
  variable_name: z.string(),
  chunk_size: z.number().int().min(1),
  output_variable: z.string(),
})

export const RlmPlanSplitCodeLanguageSchema = z.enum(["typescript", "python", "go"])
export type RlmPlanSplitCodeLanguage = z.infer<typeof RlmPlanSplitCodeLanguageSchema>

export const RlmPlanSplitCodeGranularitySchema = z.enum(["function", "class", "block"])
export type RlmPlanSplitCodeGranularity = z.infer<typeof RlmPlanSplitCodeGranularitySchema>

export const RlmPlanSplitCodeOpSchema = z.object({
  op: z.literal("split_code"),
  variable_name: z.string(),
  language: RlmPlanSplitCodeLanguageSchema,
  output_variable: z.string(),
  granularity: RlmPlanSplitCodeGranularitySchema.optional(),
})
export type RlmPlanSplitCodeOp = z.infer<typeof RlmPlanSplitCodeOpSchema>

const RlmPlanSelectOpSchema = z.object({
  op: z.literal("select"),
  variable_name: z.string(),
  indices: z.array(z.number().int().min(0)).optional(),
  filter: z.string().optional(),
  output_variable: z.string(),
})

const RlmPlanMapLlmOpSchema = z.object({
  op: z.literal("map_llm"),
  variable_name: z.string(),
  prompt: z.string(),
  output_variable: z.string(),
})

const RlmPlanMapRlmOpSchema = z.object({
  op: z.literal("map_rlm"),
  variable_name: z.string(),
  prompt: z.string(),
  output_variable: z.string(),
})

const RlmPlanConcatOpSchema = z.object({
  op: z.literal("concat"),
  variable_name: z.string(),
  output_variable: z.string(),
})

const RlmPlanReduceLlmOpSchema = z.object({
  op: z.literal("reduce_llm"),
  variable_name: z.string(),
  prompt: z.string(),
  output_variable: z.string(),
})

const RlmPlanExecOpSchema = z.object({
  op: z.literal("exec"),
  code: z.string(),
  output_variable: z.string().optional(),
})

const RlmPlanWriteVarOpSchema = z.object({
  op: z.literal("write_var"),
  variable_name: z.string(),
  content: z.string(),
})

const RlmPlanFinalVarOpSchema = z.object({
  op: z.literal("final_var"),
  variable_name: z.string(),
})

export const RlmPlanOperationSchema = z.discriminatedUnion("op", [
  RlmPlanSplitOpSchema,
  RlmPlanSplitCodeOpSchema,
  RlmPlanSelectOpSchema,
  RlmPlanMapLlmOpSchema,
  RlmPlanMapRlmOpSchema,
  RlmPlanConcatOpSchema,
  RlmPlanReduceLlmOpSchema,
  RlmPlanWriteVarOpSchema,
  RlmPlanExecOpSchema,
  RlmPlanFinalVarOpSchema,
])

export const RlmPlanInputSchema = z.object({
  operations: z.array(RlmPlanOperationSchema).min(1),
})

export type RlmPlanInput = z.infer<typeof RlmPlanInputSchema>

export const RlmFinishInputSchema = z
  .object({
    variable_name: z.string().optional(),
    value: z.string().optional(),
  })
  .refine(
    (data) => (data.variable_name !== undefined) !== (data.value !== undefined),
    { message: "Exactly one of 'variable_name' or 'value' must be provided" },
  )

export type RlmFinishInput = z.infer<typeof RlmFinishInputSchema>

/** NOT a public tool schema — used only by initRlmSession internal helper. */
export const InitRlmSessionInputSchema = z
  .object({
    sessionId: z.string(),
    query: z.string().optional(),
    rootQuery: z.string().optional(),
    taskPrompt: z.string().optional(),
    content: z.string().optional(),
    file_path: z.string().optional(),
    depth: z.number().int().min(0).optional(),
    parentSessionId: z.string().optional(),
    maxDepth: z.number().int().min(1),
    contextDir: z.string(),
    shouldDistill: z.boolean().default(false),
  })
  .refine(
    (data) => (data.content !== undefined) !== (data.file_path !== undefined),
    { message: "Exactly one of 'content' or 'file_path' must be provided" },
  )
  .refine(
    (data) => data.query !== undefined || (data.rootQuery !== undefined && data.taskPrompt !== undefined),
    { message: "Either 'query' or both 'rootQuery' and 'taskPrompt' must be provided" },
  )

export type InitRlmSessionInput = z.infer<typeof InitRlmSessionInputSchema>
