import { z } from "zod";

export const ClaudeCodeSkillsConfigSchema = z.union([
  z.boolean(),
  z.object({
    claude: z.boolean().optional(),
    agents: z.boolean().optional(),
  }),
]);

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: ClaudeCodeSkillsConfigSchema.optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
});

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
