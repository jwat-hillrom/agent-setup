import { existsSync } from "node:fs";
import { join } from "node:path";

const USER_SKILL_DIRS = [".copilot/skills", ".claude/skills", ".agents/skills"];

export function findUserLevelDuplicates({ home, sources, entries }) {
  const warnings = [];
  for (const dir of USER_SKILL_DIRS) {
    const hits = entries
      .filter((e) => existsSync(join(home, dir, e.originalName)) || existsSync(join(home, dir, e.dest)))
      .map((e) => e.originalName);
    if (hits.length) warnings.push(`~/${dir} already has ${hits.join(", ")}; the repo-level copy will show up as a duplicate`);
  }
  for (const s of sources) {
    if (s.vscodePlugin && existsSync(join(home, ".vscode", "agent-plugins", s.vscodePlugin))) {
      warnings.push(`the VS Code plugin ${s.vscodePlugin} is installed at user level; ${s.id} skills will show up twice`);
    }
  }
  return warnings;
}
