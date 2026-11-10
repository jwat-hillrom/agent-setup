#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyPlan, readLock, uninstall } from "./lib/apply.mjs";
import { fetchTag, resolveLatestTag } from "./lib/fetch.mjs";
import { findUserLevelDuplicates } from "./lib/duplicates.mjs";
import { planInstall } from "./lib/plan.mjs";
import { isReleaseTag } from "./lib/release.mjs";
import { rerun, selfUpdate } from "./lib/selfupdate.mjs";
import { discoverAgents, discoverSkills } from "./lib/sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function defaultCacheDir() {
  if (process.env.AGENT_SETUP_CACHE) return process.env.AGENT_SETUP_CACHE;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "agent-setup");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "agent-setup");
}

function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      "cache-dir": { type: "string" },
      skip: { type: "string", multiple: true },
      update: { type: "boolean" },
      "dry-run": { type: "boolean" },
      uninstall: { type: "boolean" },
      "no-self-update": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return console.log(USAGE);
  if (!values["no-self-update"] && !process.env.AGENT_SETUP_UPDATED && selfUpdate(HERE)) rerun(process.argv.slice(1));

  const repoDir = findRepoRoot(resolve(values.repo ?? process.cwd()));

  if (values.uninstall) {
    uninstall(repoDir);
    return console.log("uninstalled");
  }

  const configPath = resolve(values.config ?? join(HERE, "config.json"));
  const configDir = dirname(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const cacheDir = resolve(values["cache-dir"] ?? defaultCacheDir());
  const skip = new Set((values.skip ?? []).flatMap((s) => s.split(",")));
  const previous = readLock(repoDir);

  const active = config.sources.filter((s) => !skip.has(s.id));
  const planSources = [];
  const lockSources = {};
  const notices = [];
  const retain = [];
  for (const src of active) {
    const before = previous.sources[src.id];
    let acquired;
    try {
      acquired = acquire(src, before);
    } catch (err) {
      if (!src.optional) throw err;
      console.log(`warning: ${src.id}: could not be fetched, skipped (${firstLine(err.stderr || err.message)})`);
      retain.push(src.prefix);
      if (before) lockSources[src.id] = before;
      continue;
    }
    const { locked, planSource } = describeSource(src, acquired, before);
    lockSources[src.id] = locked;
    planSources.push(planSource);
  }

  function acquire(src, before) {
    if (src.path) return { root: resolve(configDir, src.path), locked: { path: src.path } };
    const reuse = !values.update && before?.repo === src.repo && isReleaseTag(before.tag ?? "") && before.tag;
    const tag = reuse || resolveLatestTag(src.repo);
    const fetched = fetchTag(src.repo, tag, cacheDir, src.id);
    return { root: fetched.dir, locked: { repo: src.repo, tag, sha: fetched.sha } };
  }

  function describeSource(src, { root, locked }, before) {
    const skills = discoverSkills(root, src.discover);
    const agents = src.agents ? discoverAgents(root, src.agents.dir) : [];
    for (const [kind, found, include, catalogKey] of [
      ["skills", skills, src.include, "catalog"],
      ["agents", agents, src.agents?.include, "agentCatalog"],
    ]) {
      if (!include) continue;
      locked[catalogKey] = found.map((i) => i.name);
      if (!values.update || !before?.[catalogKey]) continue;
      const known = new Set([...before[catalogKey], ...include]);
      const fresh = locked[catalogKey].filter((n) => !known.has(n));
      if (fresh.length) notices.push(`${src.id}: ${fresh.length} new upstream ${kind} not installed: ${fresh.join(", ")}`);
    }
    const planSource = {
      id: src.id,
      prefix: src.prefix,
      include: src.include,
      skills,
      agents,
      agentInclude: src.agents?.include,
      ignore: src.ignore,
    };
    return { locked, planSource };
  }

  const plan = planInstall(planSources);
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  for (const n of notices) console.log(`notice: ${n}`);
  if (values["dry-run"]) {
    for (const e of plan.entries) console.log(`would install skill ${e.dest}`);
    for (const e of plan.agentEntries) console.log(`would install agent ${e.dest}`);
    return;
  }

  const files = [
    {
      path: ".github/instructions/agent-setup.instructions.md",
      content: readFileSync(resolve(configDir, config.instructions), "utf8"),
    },
  ];

  const result = applyPlan(repoDir, {
    entries: plan.entries,
    agentEntries: plan.agentEntries,
    files,
    sources: lockSources,
    ignore: plan.ignore,
    retain,
  });
  for (const w of result.warnings) console.log(`warning: ${w}`);
  for (const w of findUserLevelDuplicates({ home: homedir(), sources: active, entries: plan.entries })) {
    console.log(`warning: ${w}`);
  }
  console.log(`installed ${result.installed.length} skills and ${result.installedAgents.length} agents into ${join(repoDir, ".github")}`);
  const setupSkill = "pocock-setup-matt-pocock-skills";
  if (result.installed.includes(setupSkill) && !existsSync(join(repoDir, "docs", "agents", "issue-tracker.md"))) {
    console.log(`next: run /${setupSkill} once in this repo to configure the issue tracker and triage labels`);
  }
}

const USAGE = `Usage: agent-setup [--repo <dir>] [--skip <id,...>] [--update] [--dry-run] [--uninstall] [--no-self-update]`;

const firstLine = (text) => String(text).split(/\r?\n/).find((l) => l.trim())?.trim() ?? "unknown error";

function findRepoRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error(`${dir} is not inside a git repository`);
  }
}

try {
  main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
