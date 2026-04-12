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
});
