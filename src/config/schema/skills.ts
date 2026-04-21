import { z } from "zod"

export const SkillSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    glob: z.string().optional(),
  }),
])

export const SkillDefinitionSchema = z.object({
  description: z.string().optional(),
  template: z.string().optional(),
  from: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  subtask: z.boolean().optional(),
  "argument-hint": z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  "allowed-tools": z.array(z.string()).optional(),
  disable: z.boolean().optional(),
})

export const SkillEntrySchema = z.union([z.boolean(), SkillDefinitionSchema])

export const SkillsConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    sources: z.array(SkillSourceSchema).optional(),
    enable: z.array(z.string()).optional(),
    disable: z.array(z.string()).optional(),
    /**
     * Inverts the Claude Code spec default (user-invocable: true) for
     * NESTED skills only. When true, a nested skill is hidden from the
     * slash-command picker unless its SKILL.md frontmatter explicitly
     * sets `user-invocable: true`. Top-level skills are unaffected.
     *
     * Rationale: large skill hubs (quality-standard, reverse-engineering,
     * etc.) ship many child skills that authors intended as supporting
     * routines, not standalone slash commands. Flipping this flag once
     * replaces per-SKILL.md opt-out work with per-SKILL.md opt-in for
     * the few children you actually want in the picker.
     *
     * Nested skills remain fully callable by agents via the skill tool,
     * the UI Skills picker, and load_skills delegation regardless of
     * this flag.
     */
    hide_nested_by_default: z.boolean().optional(),
  }).catchall(SkillEntrySchema),
])

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>
