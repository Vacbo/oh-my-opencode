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
  loadGlobalAgentsSkills,
  loadProjectAgentsSkills,
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
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
  const slashOptions = { hideNestedByDefault };

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
    includeClaudeSkills ? loadUserSkills(slashOptions) : Promise.resolve({}),
    includeAgentsSkills ? loadGlobalAgentsSkills(slashOptions) : Promise.resolve({}),
    includeClaudeSkills ? loadProjectSkills(params.ctx.directory, slashOptions) : Promise.resolve({}),
    includeAgentsSkills ? loadProjectAgentsSkills(params.ctx.directory, slashOptions) : Promise.resolve({}),
    loadOpencodeGlobalSkills(slashOptions),
    loadOpencodeProjectSkills(params.ctx.directory, slashOptions),
  ]);

  params.config.command = {
    ...builtinCommands,
    ...skillsToCommandDefinitionRecord(configSourceSkills, slashOptions),
    ...userCommands,
    ...userSkills,
    ...globalAgentsSkills,
    ...opencodeGlobalCommands,
    ...opencodeGlobalSkills,
    ...systemCommands,
    ...projectCommands,
    ...projectSkills,
    ...projectAgentsSkills,
    ...opencodeProjectCommands,
    ...opencodeProjectSkills,
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
