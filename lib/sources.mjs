import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export function readSkillName(skillDir) {
  const text = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = fm && /^name:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(fm[1]);
  return m ? m[1] : basename(skillDir);
}

function inside(root, dir) {
  const full = resolve(root, dir);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) {
    throw new Error(`path escapes the source folder: ${dir}`);
  }
  return full;
}

function toSkill(root, rel) {
  const dir = inside(root, rel);
  if (!existsSync(join(dir, "SKILL.md"))) throw new Error(`no SKILL.md in ${rel}`);
  return { name: readSkillName(dir), dir };
}

export function discoverAgents(root, dir) {
  const base = inside(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md") && !d.name.endsWith(".agent.md"))
    .map((d) => ({ name: d.name.slice(0, -3), file: join(base, d.name) }));
}

export function discoverSkills(root, discover) {
  if (discover.pluginJson) {
    const plugin = JSON.parse(readFileSync(inside(root, discover.pluginJson), "utf8"));
    return plugin.skills.map((rel) => toSkill(root, rel));
  }
  if (discover.skillsDir) {
    const base = inside(root, discover.skillsDir);
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(base, d.name, "SKILL.md")))
      .map((d) => toSkill(root, join(discover.skillsDir, d.name)));
  }
  if (discover.paths) return discover.paths.map((rel) => toSkill(root, rel));
  throw new Error("source has no discover rule");
}
