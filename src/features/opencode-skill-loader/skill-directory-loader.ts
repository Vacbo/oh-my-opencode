import { promises as fs } from "fs";
import { basename, join } from "path";
import { resolveSymlinkAsync, isMarkdownFile } from "../../shared/file-utils";
import type { LoadedSkill, SkillScope } from "./types";
import {
  inferSkillNameFromFileName,
  loadSkillFromPath,
} from "./loaded-skill-from-path";

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
  const currentDirName = basename(options.skillsDir);

  const directories = entries.filter(
    (entry) =>
      !entry.name.startsWith(".") &&
      (entry.isDirectory() || entry.isSymbolicLink()),
  );
  const files = entries.filter(
    (entry) =>
      !entry.name.startsWith(".") &&
      !entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      entry.name !== "SKILL.md" &&
      entry.name !== `${currentDirName}.md` &&
      isMarkdownFile(entry),
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
      // no SKILL.md
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
        // no named md
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

  for (const entry of files) {
    const entryPath = join(options.skillsDir, entry.name);
    const baseName = inferSkillNameFromFileName(entryPath);
    const skill = await loadSkillFromPath({
      skillPath: entryPath,
      resolvedPath: options.skillsDir,
      defaultName: baseName,
      scope: options.scope,
      namePrefix,
      depth,
    });
    if (skill && !skillMap.has(skill.name)) {
      skillMap.set(skill.name, skill);
    }
  }

  return Array.from(skillMap.values());
}
