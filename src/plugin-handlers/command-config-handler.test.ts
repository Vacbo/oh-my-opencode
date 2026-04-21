/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";
import { applyCommandConfig } from "./command-config-handler";
import {
  getAgentDisplayName,
  getAgentListDisplayName,
} from "../shared/agent-display-names";

function createPluginComponents(): PluginComponents {
  return {
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  };
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
  };
}

describe("applyCommandConfig", () => {
  let loadBuiltinCommandsSpy: ReturnType<typeof spyOn>;
  let loadUserCommandsSpy: ReturnType<typeof spyOn>;
  let loadProjectCommandsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeGlobalCommandsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeProjectCommandsSpy: ReturnType<typeof spyOn>;
  let discoverConfigSourceSkillsSpy: ReturnType<typeof spyOn>;
  let discoverUserClaudeSkillsSpy: ReturnType<typeof spyOn>;
  let discoverProjectClaudeSkillsSpy: ReturnType<typeof spyOn>;
  let discoverOpencodeGlobalSkillsSpy: ReturnType<typeof spyOn>;
  let discoverOpencodeProjectSkillsSpy: ReturnType<typeof spyOn>;
  let discoverProjectAgentsSkillsSpy: ReturnType<typeof spyOn>;
  let discoverGlobalAgentsSkillsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loadBuiltinCommandsSpy = spyOn(builtinCommands, "loadBuiltinCommands").mockReturnValue({});
    loadUserCommandsSpy = spyOn(commandLoader, "loadUserCommands").mockResolvedValue({});
    loadProjectCommandsSpy = spyOn(commandLoader, "loadProjectCommands").mockResolvedValue({});
    loadOpencodeGlobalCommandsSpy = spyOn(commandLoader, "loadOpencodeGlobalCommands").mockResolvedValue({});
    loadOpencodeProjectCommandsSpy = spyOn(commandLoader, "loadOpencodeProjectCommands").mockResolvedValue({});
    discoverConfigSourceSkillsSpy = spyOn(skillLoader, "discoverConfigSourceSkills").mockResolvedValue([]);
    discoverUserClaudeSkillsSpy = spyOn(skillLoader, "discoverUserClaudeSkills").mockResolvedValue([]);
    discoverProjectClaudeSkillsSpy = spyOn(skillLoader, "discoverProjectClaudeSkills").mockResolvedValue([]);
    discoverOpencodeGlobalSkillsSpy = spyOn(skillLoader, "discoverOpencodeGlobalSkills").mockResolvedValue([]);
    discoverOpencodeProjectSkillsSpy = spyOn(skillLoader, "discoverOpencodeProjectSkills").mockResolvedValue([]);
    discoverProjectAgentsSkillsSpy = spyOn(skillLoader, "discoverProjectAgentsSkills").mockResolvedValue([]);
    discoverGlobalAgentsSkillsSpy = spyOn(skillLoader, "discoverGlobalAgentsSkills").mockResolvedValue([]);
  });

  afterEach(() => {
    loadBuiltinCommandsSpy.mockRestore();
    loadUserCommandsSpy.mockRestore();
    loadProjectCommandsSpy.mockRestore();
    loadOpencodeGlobalCommandsSpy.mockRestore();
    loadOpencodeProjectCommandsSpy.mockRestore();
    discoverConfigSourceSkillsSpy.mockRestore();
    discoverUserClaudeSkillsSpy.mockRestore();
    discoverProjectClaudeSkillsSpy.mockRestore();
    discoverOpencodeGlobalSkillsSpy.mockRestore();
    discoverOpencodeProjectSkillsSpy.mockRestore();
    discoverProjectAgentsSkillsSpy.mockRestore();
    discoverGlobalAgentsSkillsSpy.mockRestore();
  });

  test("includes .agents skills in command config", async () => {
    // given - mocked LoadedSkill arrays with top-level skills (depth 0)
    discoverProjectAgentsSkillsSpy.mockResolvedValue([
      {
        name: "agents-project-skill",
        scope: "project",
        definition: {
          name: "agents-project-skill",
          description: "(project - Skill) Agents project skill",
          template: "template",
        },
        depth: 0,
      },
    ]);
    discoverGlobalAgentsSkillsSpy.mockResolvedValue([
      {
        name: "agents-global-skill",
        scope: "user",
        definition: {
          name: "agents-global-skill",
          description: "(user - Skill) Agents global skill",
          template: "template",
        },
        depth: 0,
      },
    ]);
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { description?: string }>;
    expect(commandConfig["agents-project-skill"]?.description).toContain("Agents project skill");
    expect(commandConfig["agents-global-skill"]?.description).toContain("Agents global skill");
  });

  test("skips .agents skills when claude_code.skills.agents is false", async () => {
    // given
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: {
        ...createPluginConfig(),
        claude_code: {
          skills: {
            agents: false,
          },
        },
      },
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    expect(discoverUserClaudeSkillsSpy).toHaveBeenCalledTimes(1);
    expect(discoverProjectClaudeSkillsSpy).toHaveBeenCalledTimes(1);
    expect(discoverGlobalAgentsSkillsSpy).not.toHaveBeenCalled();
    expect(discoverProjectAgentsSkillsSpy).not.toHaveBeenCalled();
  });

  test("loads only .agents skills when claude_code.skills.claude is false", async () => {
    // given
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: {
        ...createPluginConfig(),
        claude_code: {
          skills: {
            claude: false,
          },
        },
      },
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    expect(discoverUserClaudeSkillsSpy).not.toHaveBeenCalled();
    expect(discoverProjectClaudeSkillsSpy).not.toHaveBeenCalled();
    expect(discoverGlobalAgentsSkillsSpy).toHaveBeenCalledTimes(1);
    expect(discoverProjectAgentsSkillsSpy).toHaveBeenCalledTimes(1);
  });

  test("normalizes Atlas command agents to the runtime list name used by opencode command routing", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "start-work": {
        name: "start-work",
        description: "(builtin) Start work",
        template: "template",
        agent: "atlas",
      },
    });
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { agent?: string }>;
    expect(commandConfig["start-work"]?.agent).toBe(getAgentListDisplayName("atlas"));
  });

  test("normalizes legacy display-name command agents to the runtime list name", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "start-work": {
        name: "start-work",
        description: "(builtin) Start work",
        template: "template",
        agent: getAgentDisplayName("atlas"),
      },
    });
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { agent?: string }>;
    expect(commandConfig["start-work"]?.agent).toBe(getAgentListDisplayName("atlas"));
  });
});
