import type { OhMyOpenCodeConfig, SkillsConfig } from "../config";
import {
  getAgentConfigKey,
  getAgentListDisplayName,
} from "../shared/agent-display-names";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader";
import { loadBuiltinCommands } from "../features/builtin-commands";
import {
  discoverConfigSourceSkills,
  discoverGlobalAgentsSkills,
  discoverProjectAgentsSkills,
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
import type { LoadedSkill } from "../features/opencode-skill-loader";
import {
  detectExternalSkillPlugin,
  getSkillPluginConflictWarning,
  log,
} from "../shared";
import { resolveSkillSourceSettings } from "../shared/skill-source-settings";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
  });
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

  const includeClaudeCommands = params.pluginConfig.claude_code?.commands ?? true;
  const { includeClaudeSkills, includeAgentsSkills } = resolveSkillSourceSettings(
    params.pluginConfig,
  );

  const externalSkillPlugin = detectExternalSkillPlugin(params.ctx.directory);
  if (includeClaudeSkills && externalSkillPlugin.detected) {
    log(getSkillPluginConflictWarning(externalSkillPlugin.pluginName!));
  }

  const hideNestedByDefault = resolveHideNestedByDefault(params.pluginConfig.skills);

  const emptySkills: LoadedSkill[] = [];

  const [
    configSourceSkills,
    userCommands,
    projectCommands,
    opencodeGlobalCommands,
    opencodeProjectCommands,
    userSkills,
    globalAgentsSkills,
    projectSkills,
    projectAgentsSkills,
    opencodeGlobalSkills,
    opencodeProjectSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.ctx.directory,
    }),
    includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
    includeClaudeCommands ? loadProjectCommands(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeGlobalCommands(),
    loadOpencodeProjectCommands(params.ctx.directory),
    includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve(emptySkills),
    includeAgentsSkills ? discoverGlobalAgentsSkills() : Promise.resolve(emptySkills),
    includeClaudeSkills ? discoverProjectClaudeSkills(params.ctx.directory) : Promise.resolve(emptySkills),
    includeAgentsSkills ? discoverProjectAgentsSkills(params.ctx.directory) : Promise.resolve(emptySkills),
    discoverOpencodeGlobalSkills(),
    discoverOpencodeProjectSkills(params.ctx.directory),
  ]);

  // Register skill sources sequentially in a deterministic priority order so
  // flat-name ownership (via the shared keyAssignedTo map) is stable across
  // runs. The priority order below matches the spread order used to merge
  // the resulting records onto params.config.command below.
  const keyAssignedTo = new Map<string, string>();
  const skillOptions = { hideNestedByDefault, keyAssignedTo };

  const configSourceRecord = skillsToCommandDefinitionRecord(configSourceSkills, skillOptions);
  const userSkillsRecord = skillsToCommandDefinitionRecord(userSkills, skillOptions);
  const globalAgentsSkillsRecord = skillsToCommandDefinitionRecord(globalAgentsSkills, skillOptions);
  const opencodeGlobalSkillsRecord = skillsToCommandDefinitionRecord(opencodeGlobalSkills, skillOptions);
  const projectSkillsRecord = skillsToCommandDefinitionRecord(projectSkills, skillOptions);
  const projectAgentsSkillsRecord = skillsToCommandDefinitionRecord(projectAgentsSkills, skillOptions);
  const opencodeProjectSkillsRecord = skillsToCommandDefinitionRecord(opencodeProjectSkills, skillOptions);

  params.config.command = {
    ...builtinCommands,
    ...configSourceRecord,
    ...userCommands,
    ...userSkillsRecord,
    ...globalAgentsSkillsRecord,
    ...opencodeGlobalCommands,
    ...opencodeGlobalSkillsRecord,
    ...systemCommands,
    ...projectCommands,
    ...projectSkillsRecord,
    ...projectAgentsSkillsRecord,
    ...opencodeProjectCommands,
    ...opencodeProjectSkillsRecord,
    ...params.pluginComponents.commands,
    ...params.pluginComponents.skills,
  };

  remapCommandAgentFields(params.config.command as Record<string, Record<string, unknown>>);
}

function remapCommandAgentFields(commands: Record<string, Record<string, unknown>>): void {
  for (const cmd of Object.values(commands)) {
    if (cmd?.agent && typeof cmd.agent === "string") {
      cmd.agent = getAgentListDisplayName(getAgentConfigKey(cmd.agent));
    }
  }
}

function resolveHideNestedByDefault(skillsConfig: SkillsConfig | undefined): boolean {
  if (!skillsConfig || Array.isArray(skillsConfig) || typeof skillsConfig !== "object") {
    return false;
  }
  const value = (skillsConfig as { hide_nested_by_default?: unknown }).hide_nested_by_default;
  return value === true;
}
