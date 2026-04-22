import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkillsFromDir } from "./skill-directory-loader";

function writeSkill(
  directory: string,
  name: string,
  description: string,
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  );
}

describe("loadSkillsFromDir", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("keeps recursing when a directory already contains SKILL.md", async () => {
    // given
    const tempDir = mkdtempSync(join(tmpdir(), "omo-skill-directory-loader-"));
    tempDirs.push(tempDir);
    const rootSkillsDir = join(tempDir, "skills");

    writeSkill(
      join(rootSkillsDir, "parent"),
      "parent",
      "Parent skill discovered from directory root",
    );
    writeSkill(
      join(rootSkillsDir, "parent", "nested-child"),
      "nested-child",
      "Nested child skill discovered below a parent skill directory",
    );

    // when
    const loadedSkills = await loadSkillsFromDir({
      skillsDir: rootSkillsDir,
      scope: "user",
      maxDepth: 2,
    });

    // then
    expect(loadedSkills.map((skill) => skill.name).sort()).toEqual([
      "parent",
      "parent/nested-child",
    ]);
  });

  it("marks top-level skills with depth 0 and nested skills with depth 1 and flatName", async () => {
    // given
    const tempDir = mkdtempSync(join(tmpdir(), "omo-skill-directory-loader-"));
    tempDirs.push(tempDir);
    const rootSkillsDir = join(tempDir, "skills");

    writeSkill(join(rootSkillsDir, "parent"), "parent", "Parent description");
    writeSkill(
      join(rootSkillsDir, "parent", "child"),
      "child",
      "Child description",
    );

    // when
    const loadedSkills = await loadSkillsFromDir({
      skillsDir: rootSkillsDir,
      scope: "user",
      maxDepth: 2,
    });

    // then
    const byName = new Map(loadedSkills.map((skill) => [skill.name, skill]));
    const parent = byName.get("parent");
    const child = byName.get("parent/child");

    expect(parent?.depth).toBe(0);
    expect(parent?.flatName).toBeUndefined();

    expect(child?.depth).toBe(1);
    expect(child?.flatName).toBe("child");
  });

  it("reads user-invocable from SKILL.md frontmatter", async () => {
    // given
    const tempDir = mkdtempSync(join(tmpdir(), "omo-skill-directory-loader-"));
    tempDirs.push(tempDir);
    const rootSkillsDir = join(tempDir, "skills");

    mkdirSync(join(rootSkillsDir, "hidden-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "hidden-skill", "SKILL.md"),
      `---\nname: hidden-skill\ndescription: Hidden from slash\nuser-invocable: false\n---\nBody\n`,
    );

    mkdirSync(join(rootSkillsDir, "visible-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "visible-skill", "SKILL.md"),
      `---\nname: visible-skill\ndescription: Visible in slash\nuser-invocable: true\n---\nBody\n`,
    );

    mkdirSync(join(rootSkillsDir, "default-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "default-skill", "SKILL.md"),
      `---\nname: default-skill\ndescription: No user-invocable field\n---\nBody\n`,
    );

    // when
    const loadedSkills = await loadSkillsFromDir({
      skillsDir: rootSkillsDir,
      scope: "user",
    });

    // then
    const byName = new Map(loadedSkills.map((s) => [s.name, s]));
    expect(byName.get("hidden-skill")?.userInvocable).toBe(false);
    expect(byName.get("visible-skill")?.userInvocable).toBe(true);
    expect(byName.get("default-skill")?.userInvocable).toBeUndefined();
  });

  it("reads disable-model-invocation from SKILL.md frontmatter", async () => {
    // given
    const tempDir = mkdtempSync(join(tmpdir(), "omo-skill-directory-loader-"));
    tempDirs.push(tempDir);
    const rootSkillsDir = join(tempDir, "skills");

    mkdirSync(join(rootSkillsDir, "user-only-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "user-only-skill", "SKILL.md"),
      `---\nname: user-only-skill\ndescription: User only\ndisable-model-invocation: true\n---\nBody\n`,
    );

    mkdirSync(join(rootSkillsDir, "model-allowed-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "model-allowed-skill", "SKILL.md"),
      `---\nname: model-allowed-skill\ndescription: Model allowed\ndisable-model-invocation: false\n---\nBody\n`,
    );

    mkdirSync(join(rootSkillsDir, "default-invocation-skill"), { recursive: true });
    writeFileSync(
      join(rootSkillsDir, "default-invocation-skill", "SKILL.md"),
      `---\nname: default-invocation-skill\ndescription: No disable-model-invocation field\n---\nBody\n`,
    );

    // when
    const loadedSkills = await loadSkillsFromDir({
      skillsDir: rootSkillsDir,
      scope: "user",
    });

    // then
    const byName = new Map(loadedSkills.map((s) => [s.name, s]));
    expect(byName.get("user-only-skill")?.disableModelInvocation).toBe(true);
    expect(byName.get("model-allowed-skill")?.disableModelInvocation).toBe(false);
    expect(byName.get("default-invocation-skill")?.disableModelInvocation).toBeUndefined();
  });
});
