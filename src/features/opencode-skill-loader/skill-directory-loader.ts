import { promises as fs } from "fs";
import { join } from "path";
import { resolveSymlinkAsync } from "../../shared/file-utils";
import type { LoadedSkill, SkillScope } from "./types";
import { loadSkillFromPath } from "./loaded-skill-from-path";

export async function loadSkillsFromDir(options: {
  skillsDir: string;
  scope: SkillScope;
  namePrefix?: string;
  depth?: number;
  maxDepth?: number;
}): Promise<LoadedSkill[]> {
  const namePrefix = options.namePrefix ?? "";
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 2;

  const entries = await fs
    .readdir(options.skillsDir, { withFileTypes: true })
    .catch(() => []);
  const skillMap = new Map<string, LoadedSkill>();

  const directories = entries.filter(
    (entry) =>
      !entry.name.startsWith(".") &&
      (entry.isDirectory() || entry.isSymbolicLink()),
  );

  for (const entry of directories) {
    const entryPath = join(options.skillsDir, entry.name);
    const resolvedPath = await resolveSymlinkAsync(entryPath);
    const dirName = entry.name;
    let directorySkillLoaded = false;

    const skillMdPath = join(resolvedPath, "SKILL.md");
    try {
      await fs.access(skillMdPath);
      const skill = await loadSkillFromPath({
        skillPath: skillMdPath,
        resolvedPath,
        defaultName: dirName,
        scope: options.scope,
        namePrefix,
        depth,
      });
      if (skill && !skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill);
      }
      directorySkillLoaded = true;
    } catch {
      // no SKILL.md in this directory; try {dirName}.md fallback below
    }

    if (!directorySkillLoaded) {
      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`);
      try {
        await fs.access(namedSkillMdPath);
        const skill = await loadSkillFromPath({
          skillPath: namedSkillMdPath,
          resolvedPath,
          defaultName: dirName,
          scope: options.scope,
          namePrefix,
          depth,
        });
        if (skill && !skillMap.has(skill.name)) {
          skillMap.set(skill.name, skill);
        }
      } catch {
        // no entrypoint file in this directory; recurse below if depth allows
      }
    }

    if (depth < maxDepth) {
      const newPrefix = namePrefix ? `${namePrefix}/${dirName}` : dirName;
      const nestedSkills = await loadSkillsFromDir({
        skillsDir: resolvedPath,
        scope: options.scope,
        namePrefix: newPrefix,
        depth: depth + 1,
        maxDepth,
      });
      for (const nestedSkill of nestedSkills) {
        if (!skillMap.has(nestedSkill.name)) {
          skillMap.set(nestedSkill.name, nestedSkill);
        }
      }
    }
  }

  return Array.from(skillMap.values());
}
