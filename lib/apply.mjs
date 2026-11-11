import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { convertAgent } from "./agents.mjs";
import { isValidSkillName, rewriteSkillName } from "./plan.mjs";
import { rewriteLinks, rewriteReferences } from "./rewrite.mjs";

const SKILLS = ".github/skills";
const AGENTS = ".github/agents";
const LOCK = ".github/agent-setup.lock.json";
const BEGIN = "# >>> agent-setup (managed) >>>";
const END = "# <<< agent-setup (managed) <<<";

const agentPath = (repoDir, dest) => join(repoDir, AGENTS, `${dest}.agent.md`);

export function readLock(repoDir) {
  const file = join(repoDir, LOCK);
  const empty = { version: 1, sources: {}, skills: [], agents: [], files: [] };
  return existsSync(file) ? { ...empty, ...JSON.parse(readFileSync(file, "utf8")) } : empty;
}

const toPosix = (p) => p.split(sep).join("/");

function markdownFiles(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) out.push(...markdownFiles(full));
    else if (d.isFile() && d.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function rewriteSkill(target, e, rw) {
  const ownDir = toPosix(relative(rw.root, e.srcDir));
  for (const file of markdownFiles(target)) {
    const relDir = toPosix(relative(target, dirname(file)));
    const text = readFileSync(file, "utf8");
    const next = rewriteLinks(rewriteReferences(text, rw.names), {
      fileDir: posix.join(ownDir, relDir),
      ownDir,
      installedDir: posix.join(SKILLS, e.dest, relDir),
      skillDirs: rw.skillDirs,
      webBase: rw.webBase,
    });
    if (next !== text) writeFileSync(file, next);
  }
}

function rewriteAgent(text, e, rw) {
  const ownDir = toPosix(relative(rw.root, e.srcFile));
  return rewriteLinks(rewriteReferences(text, rw.names), {
    fileDir: posix.dirname(ownDir),
    ownDir,
    installedDir: AGENTS,
    skillDirs: rw.skillDirs,
    webBase: rw.webBase,
  });
}

export function applyPlan(repoDir, { entries, agentEntries = [], files = [], sources = {}, ignore = [], retain = [], rewrites = {} }) {
  const previous = readLock(repoDir);
  const ownedSkills = new Set(previous.skills);
  const ownedAgents = new Set(previous.agents);
  const warnings = [];
  const installed = [];
  const installedAgents = [];
  const fromRetained = (name) => retain.some((p) => name.startsWith(`${p}-`));

  for (const e of entries) {
    const target = join(repoDir, SKILLS, e.dest);
    if (existsSync(target) && !ownedSkills.has(e.dest)) {
      warnings.push(`skipped ${e.dest}: ${SKILLS}/${e.dest} already exists and was not installed by this tool`);
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(e.srcDir, target, { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() });
    const skillMd = join(target, "SKILL.md");
    writeFileSync(skillMd, rewriteSkillName(readFileSync(skillMd, "utf8"), e.dest));
    if (rewrites[e.source]) rewriteSkill(target, e, rewrites[e.source]);
    installed.push(e.dest);
  }

  for (const e of agentEntries) {
    const target = agentPath(repoDir, e.dest);
    if (existsSync(target) && !ownedAgents.has(e.dest)) {
      warnings.push(`skipped ${e.dest}: ${AGENTS}/${e.dest}.agent.md already exists and was not installed by this tool`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    const agent = convertAgent(readFileSync(e.srcFile, "utf8"), e.dest);
    writeFileSync(target, rewrites[e.source] ? rewriteAgent(agent, e, rewrites[e.source]) : agent);
    installedAgents.push(e.dest);
  }

  const retainedSkills = previous.skills.filter((n) => fromRetained(n) && !installed.includes(n));
  const retainedAgents = previous.agents.filter((n) => fromRetained(n) && !installedAgents.includes(n));
  const keep = new Set([...installed, ...retainedSkills]);
  for (const name of previous.skills) {
    if (!keep.has(name) && isValidSkillName(name)) {
      rmSync(join(repoDir, SKILLS, name), { recursive: true, force: true });
    }
  }
  const keepAgents = new Set([...installedAgents, ...retainedAgents]);
  for (const name of previous.agents) {
    if (!keepAgents.has(name) && isValidSkillName(name)) rmSync(agentPath(repoDir, name), { force: true });
  }

  const writtenFiles = [];
  for (const f of files) {
    const full = join(repoDir, f.path);
    if (existsSync(full) && !previous.files.includes(f.path)) {
      warnings.push(`skipped ${f.path}: it already exists and was not written by this tool`);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
    writtenFiles.push(f.path);
  }

  const prefixes = [...new Set([...entries.map((e) => e.prefix), ...retain.filter((p) => retainedSkills.some((n) => n.startsWith(`${p}-`)))])];
  const agentPrefixes = [...new Set([...agentEntries.map((e) => e.prefix), ...retain.filter((p) => retainedAgents.some((n) => n.startsWith(`${p}-`)))])];
  const lock = {
    version: 1,
    sources,
    skills: [...installed, ...retainedSkills],
    agents: [...installedAgents, ...retainedAgents],
    files: writtenFiles,
  };
  writeFileSync(join(repoDir, LOCK), JSON.stringify(lock, null, 2) + "\n");
  const patterns = [
    ...prefixes.map((p) => `${SKILLS}/${p}-*`),
    ...agentPrefixes.map((p) => `${AGENTS}/${p}-*`),
    ...lock.files,
    ...ignore,
    LOCK,
  ];
  writeExcludeBlock(repoDir, patterns);
  return { warnings, installed, installedAgents };
}

export function uninstall(repoDir) {
  const lock = readLock(repoDir);
  const githubDir = resolve(repoDir, ".github");
  for (const name of lock.skills) {
    if (isValidSkillName(name)) rmSync(join(repoDir, SKILLS, name), { recursive: true, force: true });
  }
  for (const name of lock.agents) {
    if (isValidSkillName(name)) rmSync(agentPath(repoDir, name), { force: true });
  }
  for (const rel of lock.files) {
    const full = resolve(repoDir, rel);
    if (full.startsWith(githubDir + sep)) rmSync(full, { force: true });
  }
  rmSync(join(repoDir, LOCK), { force: true });
  const file = excludePath(repoDir);
  if (existsSync(file)) writeFileSync(file, stripBlock(readFileSync(file, "utf8")));
}

function excludePath(repoDir) {
  const p = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  return isAbsolute(p) ? p : resolve(repoDir, p);
}

function writeExcludeBlock(repoDir, patterns) {
  const file = excludePath(repoDir);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const without = stripBlock(current);
  const block = [BEGIN, ...patterns, END].join("\n") + "\n";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, (without && !without.endsWith("\n") ? without + "\n" : without) + block);
}

function stripBlock(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(0, start) + text.slice(end + END.length).replace(/^\r?\n/, "");
}
