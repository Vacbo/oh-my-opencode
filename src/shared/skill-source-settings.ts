import type { OhMyOpenCodeConfig } from "../config";

export type SkillSourceSettings = {
  includeClaudeSkills: boolean;
  includeAgentsSkills: boolean;
};

export function resolveSkillSourceSettings(
  pluginConfig: OhMyOpenCodeConfig,
): SkillSourceSettings {
  const skillsConfig = pluginConfig.claude_code?.skills;

  if (skillsConfig === false) {
    return {
      includeClaudeSkills: false,
      includeAgentsSkills: false,
    };
  }

  if (skillsConfig === true || skillsConfig === undefined) {
    return {
      includeClaudeSkills: true,
      includeAgentsSkills: true,
    };
  }

  return {
    includeClaudeSkills: skillsConfig.claude !== false,
    includeAgentsSkills: skillsConfig.agents !== false,
  };
}
