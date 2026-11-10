import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, readLock, uninstall } from "../lib/apply.mjs";
import { git, makeRepo, tempDir, writeTree } from "./helpers.mjs";

function fixtureSkill(name, extra = {}) {
  const dir = tempDir("agent-setup-src-");
  writeTree(dir, {
    "SKILL.md": `---\nname: ${name}\ndescription: d\n---\nbody\n`,
    "notes/extra.md": "extra\n",
    ...extra,
  });
  return dir;
}

function entry(source, name, srcDir) {
  return { source, prefix: source, originalName: name, srcDir, dest: `${source}-${name}` };
}

test("copies a skill into .github/skills under its prefixed name with the name rewritten", () => {
  const repo = makeRepo();
  const src = fixtureSkill("tdd");

  applyPlan(repo, { entries: [entry("pocock", "tdd", src)], files: [], sources: {} });

  const skillMd = readFileSync(join(repo, ".github/skills/pocock-tdd/SKILL.md"), "utf8");
  assert.match(skillMd, /^---\nname: pocock-tdd\n/);
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/notes/extra.md")));
});

test("writes managed files, a lock file and an exclude block listing prefix globs", () => {
  const repo = makeRepo();
  const src = fixtureSkill("tdd");

  applyPlan(repo, {
    entries: [entry("pocock", "tdd", src)],
    files: [{ path: ".github/instructions/agent-setup.instructions.md", content: "rules\n" }],
    sources: { pocock: { repo: "https://example.com/p", tag: "v1.0.0", sha: "abc" } },
  });

  assert.equal(readFileSync(join(repo, ".github/instructions/agent-setup.instructions.md"), "utf8"), "rules\n");
  const lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.equal(lock.sources.pocock.tag, "v1.0.0");
  assert.deepEqual(lock.skills, ["pocock-tdd"]);
  const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
  assert.match(exclude, /^\.github\/skills\/pocock-\*$/m);
  assert.match(exclude, /^\.github\/instructions\/agent-setup\.instructions\.md$/m);
  assert.match(exclude, /^\.github\/agent-setup\.lock\.json$/m);
  assert.equal(git(repo, "status", "--porcelain"), "");
});


test("re-running is idempotent and removes skills dropped from the plan", () => {
  const repo = makeRepo();
  const tdd = fixtureSkill("tdd");
  const pr = fixtureSkill("pr");
  const both = { entries: [entry("pocock", "tdd", tdd), entry("pocock", "pr", pr)] };

  applyPlan(repo, both);
  const excludeAfterFirst = readFileSync(join(repo, ".git/info/exclude"), "utf8");
  applyPlan(repo, both);
  assert.equal(readFileSync(join(repo, ".git/info/exclude"), "utf8"), excludeAfterFirst);

  applyPlan(repo, { entries: [entry("pocock", "tdd", tdd)] });
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd")));
  assert.ok(!existsSync(join(repo, ".github/skills/pocock-pr")));
});

test("keeps the user's existing exclude lines around the managed block", () => {
  const repo = makeRepo();
  writeTree(repo, { ".git/info/exclude": "# mine\nscratch/\n" });
  applyPlan(repo, { entries: [entry("pocock", "tdd", fixtureSkill("tdd"))] });
  applyPlan(repo, { entries: [] });

  const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
  assert.match(exclude, /^# mine\nscratch\/\n/);
  assert.equal(exclude.match(/>>> agent-setup/g).length, 1);
});

test("leaves an existing folder it did not install untouched and reports it", () => {
  const repo = makeRepo({ ".github/skills/pocock-tdd/SKILL.md": "---\nname: pocock-tdd\ndescription: mine\n---\n" });
  const result = applyPlan(repo, { entries: [entry("pocock", "tdd", fixtureSkill("tdd"))] });

  assert.match(readFileSync(join(repo, ".github/skills/pocock-tdd/SKILL.md"), "utf8"), /description: mine/);
  assert.match(result.warnings.join("\n"), /pocock-tdd/);
  const lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.deepEqual(lock.skills, []);
});

test("uninstall removes only what was installed and the managed exclude block", () => {
  const repo = makeRepo({
    ".github/skills/mine/SKILL.md": "---\nname: mine\ndescription: d\n---\n",
    ".git/info/exclude": "scratch/\n",
  });
  applyPlan(repo, {
    entries: [entry("pocock", "tdd", fixtureSkill("tdd"))],
    files: [{ path: ".github/instructions/agent-setup.instructions.md", content: "rules\n" }],
  });

  uninstall(repo);

  assert.ok(!existsSync(join(repo, ".github/skills/pocock-tdd")));
  assert.ok(!existsSync(join(repo, ".github/instructions/agent-setup.instructions.md")));
  assert.ok(!existsSync(join(repo, ".github/agent-setup.lock.json")));
  assert.ok(existsSync(join(repo, ".github/skills/mine/SKILL.md")));
  assert.equal(readFileSync(join(repo, ".git/info/exclude"), "utf8"), "scratch/\n");
});

test("does not copy symlinks from an upstream skill", (t) => {
  const repo = makeRepo();
  const src = fixtureSkill("tdd");
  try {
    symlinkSync(tempDir("agent-setup-outside-"), join(src, "escape"), "junction");
  } catch {
    return t.skip("cannot create symlinks on this machine");
  }

  applyPlan(repo, { entries: [entry("pocock", "tdd", src)] });

  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/SKILL.md")));
  assert.ok(!existsSync(join(repo, ".github/skills/pocock-tdd/escape")));
});

test("does not overwrite a managed file path that already holds the user's own file", () => {
  const repo = makeRepo({ ".github/instructions/agent-setup.instructions.md": "mine\n" });

  const result = applyPlan(repo, {
    entries: [],
    files: [{ path: ".github/instructions/agent-setup.instructions.md", content: "rules\n" }],
  });

  assert.equal(readFileSync(join(repo, ".github/instructions/agent-setup.instructions.md"), "utf8"), "mine\n");
  assert.match(result.warnings.join("\n"), /agent-setup\.instructions\.md/);
  assert.deepEqual(readLock(repo).files, []);
});

function agentEntry(source, name, srcFile) {
  return { source, prefix: source, originalName: name, srcFile, dest: `${source}-${name}` };
}

function fixtureAgent(name) {
  const dir = tempDir("agent-setup-agent-");
  writeTree(dir, { [`${name}.md`]: `---\nname: ${name}\ndescription: d\ntools: Read, Bash\nmodel: sonnet\n---\nbody\n` });
  return join(dir, `${name}.md`);
}

test("installs converted agents as .agent.md files, tracks them and excludes their prefix", () => {
  const repo = makeRepo();
  applyPlan(repo, { entries: [], agentEntries: [agentEntry("ecc", "go-reviewer", fixtureAgent("go-reviewer"))], ignore: [".taste-skill/"] });

  const agent = readFileSync(join(repo, ".github/agents/ecc-go-reviewer.agent.md"), "utf8");
  assert.match(agent, /^---\nname: ecc-go-reviewer\ndescription: "d"\ntools: \['read', 'execute'\]\n---\nbody\n$/);
  assert.deepEqual(readLock(repo).agents, ["ecc-go-reviewer"]);
  const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
  assert.match(exclude, /^\.github\/agents\/ecc-\*$/m);
  assert.match(exclude, /^\.taste-skill\/$/m);
  assert.equal(git(repo, "status", "--porcelain"), "");
});

test("removes dropped agents, keeps unmanaged agent files and uninstalls cleanly", () => {
  const repo = makeRepo({ ".github/agents/ecc-mine.agent.md": "---\nname: ecc-mine\ndescription: mine\n---\n" });
  const a = fixtureAgent("a");
  const b = fixtureAgent("b");
  applyPlan(repo, { entries: [], agentEntries: [agentEntry("ecc", "a", a), agentEntry("ecc", "b", b)] });
  const result = applyPlan(repo, { entries: [], agentEntries: [agentEntry("ecc", "a", a), agentEntry("ecc", "mine", fixtureAgent("mine"))] });

  assert.ok(existsSync(join(repo, ".github/agents/ecc-a.agent.md")));
  assert.ok(!existsSync(join(repo, ".github/agents/ecc-b.agent.md")));
  assert.match(readFileSync(join(repo, ".github/agents/ecc-mine.agent.md"), "utf8"), /description: mine/);
  assert.match(result.warnings.join("\n"), /ecc-mine/);

  uninstall(repo);
  assert.ok(!existsSync(join(repo, ".github/agents/ecc-a.agent.md")));
  assert.ok(existsSync(join(repo, ".github/agents/ecc-mine.agent.md")));
});

test("keeps what a retained source installed earlier instead of removing it as stale", () => {
  const repo = makeRepo();
  const priv = fixtureSkill("nexus");
  const pocock = fixtureSkill("tdd");
  const agent = fixtureAgent("reviewer");
  applyPlan(repo, {
    entries: [entry("private", "nexus", priv), entry("pocock", "tdd", pocock)],
    agentEntries: [agentEntry("private", "reviewer", agent)],
    sources: { private: { repo: "r", tag: "v1.0.0" }, pocock: { repo: "p", tag: "v1.0.0" } },
  });

  applyPlan(repo, { entries: [entry("pocock", "tdd", pocock)], sources: { pocock: { repo: "p", tag: "v1.0.0" } }, retain: ["private"] });

  assert.ok(existsSync(join(repo, ".github/skills/private-nexus/SKILL.md")));
  assert.ok(existsSync(join(repo, ".github/agents/private-reviewer.agent.md")));
  const lock = readLock(repo);
  assert.deepEqual(lock.skills.sort(), ["private-nexus", "pocock-tdd"].sort());
  assert.deepEqual(lock.agents, ["private-reviewer"]);
  assert.match(readFileSync(join(repo, ".git/info/exclude"), "utf8"), /^\.github\/skills\/private-\*$/m);
  assert.match(readFileSync(join(repo, ".git/info/exclude"), "utf8"), /^\.github\/agents\/private-\*$/m);
});

test("never deletes outside .github/skills even if the lock file names a path that does", () => {
  const repo = makeRepo({ "keep/me.txt": "x" });
  writeTree(repo, {
    ".github/agent-setup.lock.json": JSON.stringify({ version: 1, sources: {}, skills: ["../../keep"], files: ["../keep/me.txt"] }),
  });

  uninstall(repo);

  assert.ok(existsSync(join(repo, "keep/me.txt")));
});
