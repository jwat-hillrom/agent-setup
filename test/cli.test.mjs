import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addTag, git, makeRemote, makeRepo, tempDir, writeTree } from "./helpers.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "agent-setup.mjs");

const skillMd = (name) => `---\nname: ${name}\ndescription: d\n---\nbody\n`;

function fixtures({ eccAgentsDir = "agents", privateSource = false } = {}) {
  const pocock = makeRemote({
    "v1.0.0": {
      ".claude-plugin/plugin.json": JSON.stringify({ skills: ["./skills/engineering/tdd", "./skills/productivity/grilling"] }),
      "skills/engineering/tdd/SKILL.md": skillMd("tdd"),
      "skills/productivity/grilling/SKILL.md": skillMd("grilling"),
    },
    "v2.0.0-rc.1": { "skills/engineering/rc-only/SKILL.md": skillMd("rc-only") },
  });
  const ecc = makeRemote({
    "v2.2.3": {
      "skills/golang-testing/SKILL.md": skillMd("golang-testing"),
      "skills/tdd-workflow/SKILL.md": skillMd("tdd-workflow"),
      "agents/go-reviewer.md": "---\nname: go-reviewer\ndescription: Reviews Go. MUST BE USED for Go.\ntools: Read, Grep\nmodel: sonnet\n---\nbody\n",
      "agents/planner.md": "---\nname: planner\ndescription: Plans.\n---\nbody\n",
    },
  });
  const taste = makeRemote({
    "v2.5.1": { "skills/taste-skill/SKILL.md": skillMd("design-taste-frontend") },
  });
  const baxterRoot = tempDir("agent-setup-baxter-");
  writeTree(baxterRoot, {
    ".claude-plugin/plugin.json": JSON.stringify({ skills: ["./skills/design/nexus-design-compliance"] }),
    "skills/design/nexus-design-compliance/SKILL.md": skillMd("nexus-design-compliance"),
  });

  const configDir = tempDir("agent-setup-config-");
  writeTree(configDir, { "agent-setup.instructions.md": "precedence rules\n" });
  const config = {
    sources: [
      { id: "pocock", prefix: "pocock", repo: pathToFileURL(pocock).href, vscodePlugin: "example.test/p/skills", discover: { pluginJson: ".claude-plugin/plugin.json" } },
      { id: "ecc", prefix: "ecc", repo: pathToFileURL(ecc).href, discover: { skillsDir: "skills" }, include: ["golang-testing"], agents: { dir: eccAgentsDir, include: ["go-reviewer"] } },
      { id: "taste", prefix: "taste", repo: pathToFileURL(taste).href, discover: { paths: ["skills/taste-skill"] }, ignore: [".taste-skill/"] },
      { id: "baxter", prefix: "baxter", path: baxterRoot, discover: { pluginJson: ".claude-plugin/plugin.json" } },
    ],
    instructions: "agent-setup.instructions.md",
  };
  let privateRemote = null;
  if (privateSource) {
    privateRemote = makeRemote({
      "v1.0.0": {
        ".claude-plugin/plugin.json": JSON.stringify({ skills: ["./skills/nexus"] }),
        "skills/nexus/SKILL.md": skillMd("nexus"),
      },
    });
    const url = pathToFileURL(privateSource === "unreachable" ? join(privateRemote, "nope") : privateRemote).href;
    config.sources.push({ id: "private", prefix: "private", repo: url, optional: true, discover: { pluginJson: ".claude-plugin/plugin.json" } });
  }
  writeTree(configDir, { "config.json": JSON.stringify(config) });
  return { pocock, ecc, taste, baxterRoot, privateRemote, configPath: join(configDir, "config.json"), cache: tempDir("agent-setup-cache-"), home: tempDir("agent-setup-home-") };
}

function run(fx, repo, ...args) {
  return execFileSync(
    process.execPath,
    [CLI, "--repo", repo, "--config", fx.configPath, "--cache-dir", fx.cache, "--no-self-update", ...args],
    { encoding: "utf8", env: { ...process.env, HOME: fx.home, USERPROFILE: fx.home } },
  );
}

function toolClone() {
  const remote = makeRemote({});
  for (const entry of ["agent-setup.mjs", "lib"]) cpSync(join(dirname(CLI), entry), join(remote, entry), { recursive: true });
  addTag(remote, "v0.0.1", {});
  const clone = tempDir("agent-setup-tool-");
  git(clone, "clone", "-q", remote, ".");
  return { remote, clone, cli: join(clone, "agent-setup.mjs") };
}

function runTool(fx, cli, repo, ...args) {
  return execFileSync(process.execPath, [cli, "--repo", repo, "--config", fx.configPath, "--cache-dir", fx.cache, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: fx.home, USERPROFILE: fx.home },
  });
}

test("pulls the tool's own clone before running, then continues with the install", () => {
  const fx = fixtures();
  const tool = toolClone();
  addTag(tool.remote, "v0.0.2", { "NEWER.txt": "x\n" });
  const repo = makeRepo();

  runTool(fx, tool.cli, repo);

  assert.ok(existsSync(join(tool.clone, "NEWER.txt")));
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/SKILL.md")));
});

test("--no-self-update leaves the tool clone alone, and an unreachable tool remote does not stop the install", () => {
  const fx = fixtures();
  const tool = toolClone();
  addTag(tool.remote, "v0.0.2", { "NEWER.txt": "x\n" });
  const repo = makeRepo();

  runTool(fx, tool.cli, repo, "--no-self-update");
  assert.ok(!existsSync(join(tool.clone, "NEWER.txt")));

  renameSync(tool.remote, `${tool.remote}-gone`);
  runTool(fx, tool.cli, repo);
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/SKILL.md")));
});

test("an optional source that cannot be fetched is skipped with a warning and the rest installs", () => {
  const fx = fixtures({ privateSource: "unreachable" });
  const repo = makeRepo();

  const out = run(fx, repo);

  assert.match(out, /warning: private: could not be fetched, skipped/);
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/SKILL.md")));
  assert.ok(!existsSync(join(repo, ".github/skills/private-nexus")));
});

test("when an optional source becomes unreachable, what it installed earlier is kept", () => {
  const fx = fixtures({ privateSource: "ok" });
  const repo = makeRepo();
  run(fx, repo);
  assert.ok(existsSync(join(repo, ".github/skills/private-nexus/SKILL.md")));

  renameSync(fx.privateRemote, `${fx.privateRemote}-gone`);
  const out = run(fx, repo, "--update");

  assert.match(out, /warning: private: could not be fetched, skipped/);
  assert.ok(existsSync(join(repo, ".github/skills/private-nexus/SKILL.md")));
  const lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.equal(lock.sources.private.tag, "v1.0.0");
  assert.ok(lock.skills.includes("private-nexus"));
});

test("a required source that cannot be fetched stops the run before anything is written", () => {
  const fx = fixtures();
  const config = JSON.parse(readFileSync(fx.configPath, "utf8"));
  config.sources[0].repo = pathToFileURL(join(fx.pocock, "nope")).href;
  writeTree(dirname(fx.configPath), { "config.json": JSON.stringify(config) });
  const repo = makeRepo();

  assert.throws(() => run(fx, repo));
  assert.ok(!existsSync(join(repo, ".github")));
});

test("installs every source under its prefix at the latest stable release and keeps git clean", () => {
  const fx = fixtures();
  const repo = makeRepo();

  run(fx, repo);

  for (const dest of ["pocock-tdd", "pocock-grilling", "ecc-golang-testing", "taste-design-taste-frontend", "baxter-nexus-design-compliance"]) {
    assert.ok(existsSync(join(repo, ".github/skills", dest, "SKILL.md")), `${dest} missing`);
  }
  assert.ok(!existsSync(join(repo, ".github/skills/ecc-tdd-workflow")), "non-allowlisted ECC skill installed");
  assert.ok(!existsSync(join(repo, ".github/skills/pocock-rc-only")), "prerelease content installed");
  assert.equal(readFileSync(join(repo, ".github/instructions/agent-setup.instructions.md"), "utf8"), "precedence rules\n");
  const lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.equal(lock.sources.pocock.tag, "v1.0.0");
  assert.equal(git(repo, "status", "--porcelain"), "");
});

test("installs allowlisted agents as converted .agent.md files and excludes the Taste state folder", () => {
  const fx = fixtures();
  const repo = makeRepo();

  run(fx, repo);

  const agent = readFileSync(join(repo, ".github/agents/ecc-go-reviewer.agent.md"), "utf8");
  assert.match(agent, /^---\r?\nname: ecc-go-reviewer\r?\ndescription: "Reviews Go\."\r?\ntools: \['read', 'search'\]\r?\n---\r?\nbody\r?\n$/);
  assert.ok(!existsSync(join(repo, ".github/agents/ecc-planner.agent.md")));
  assert.match(readFileSync(join(repo, ".git/info/exclude"), "utf8"), /^\.taste-skill\/$/m);
  assert.equal(git(repo, "status", "--porcelain"), "");

  run(fx, repo, "--skip", "ecc");
  assert.ok(!existsSync(join(repo, ".github/agents/ecc-go-reviewer.agent.md")));
});

test("a source without the configured agents folder still installs, with a warning per missing agent", () => {
  const fx = fixtures({ eccAgentsDir: "no-such-folder" });
  const repo = makeRepo();

  const out = run(fx, repo);

  assert.ok(existsSync(join(repo, ".github/skills/ecc-golang-testing/SKILL.md")));
  assert.match(out, /warning: ecc: "go-reviewer" is in the agent include list but not upstream/);
});

test("--update also lists new upstream agents that are not installed", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);
  addTag(fx.ecc, "v2.3.0", { "agents/fresh-agent.md": "---\nname: fresh-agent\ndescription: d\n---\nbody\n" });

  const out = run(fx, repo, "--update");

  assert.match(out, /notice: ecc: .*fresh-agent/);
  assert.ok(!existsSync(join(repo, ".github/agents/ecc-fresh-agent.agent.md")));
});

test("re-running keeps the locked release; --update moves to the newest and lists new upstream skills", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);

  addTag(fx.pocock, "v1.1.0", { "skills/engineering/tdd/NEW.md": "new\n" });
  addTag(fx.ecc, "v2.3.0", { "skills/brand-new/SKILL.md": skillMd("brand-new") });

  run(fx, repo);
  let lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.equal(lock.sources.pocock.tag, "v1.0.0");
  assert.ok(!existsSync(join(repo, ".github/skills/pocock-tdd/NEW.md")));

  const out = run(fx, repo, "--update");
  lock = JSON.parse(readFileSync(join(repo, ".github/agent-setup.lock.json"), "utf8"));
  assert.equal(lock.sources.pocock.tag, "v1.1.0");
  assert.equal(lock.sources.ecc.tag, "v2.3.0");
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd/NEW.md")));
  assert.match(out, /brand-new/);
  assert.ok(!existsSync(join(repo, ".github/skills/ecc-brand-new")));
});

test("warns when a skill or plugin is already installed at user level", () => {
  const fx = fixtures();
  const repo = makeRepo();
  writeTree(fx.home, {
    ".copilot/skills/tdd/SKILL.md": skillMd("tdd"),
    ".vscode/agent-plugins/example.test/p/skills/plugin.json": "{}",
  });

  const out = run(fx, repo);

  assert.match(out, /warning: ~\/\.copilot\/skills already has tdd/);
  assert.match(out, /warning: .*example\.test\/p\/skills/);
});

test("--uninstall removes everything it installed", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);

  run(fx, repo, "--uninstall");

  assert.ok(!existsSync(join(repo, ".github/skills/pocock-tdd")));
  assert.ok(!existsSync(join(repo, ".github/agent-setup.lock.json")));
});

test("reminds to run the Pocock setup skill when the repo has no docs/agents yet", () => {
  const fx = fixtures();
  addTag(fx.pocock, "v1.0.1", {
    ".claude-plugin/plugin.json": JSON.stringify({ skills: ["./skills/engineering/tdd", "./skills/engineering/setup-matt-pocock-skills"] }),
    "skills/engineering/setup-matt-pocock-skills/SKILL.md": skillMd("setup-matt-pocock-skills"),
  });
  const bare = makeRepo();
  const ready = makeRepo({ "docs/agents/issue-tracker.md": "x\n" });

  assert.match(run(fx, bare), /\/pocock-setup-matt-pocock-skills/);
  assert.doesNotMatch(run(fx, ready), /pocock-setup-matt-pocock-skills/);
});

test("ignores a locked tag that is not a plain release tag and resolves the latest instead", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);
  const lockPath = join(repo, ".github/agent-setup.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.sources.pocock.tag = "../../outside";
  writeTree(repo, { ".github/agent-setup.lock.json": JSON.stringify(lock) });

  run(fx, repo);

  assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).sources.pocock.tag, "v1.0.0");
});

test("--update with --dry-run still reports new upstream skills", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);
  addTag(fx.ecc, "v2.3.0", { "skills/brand-new/SKILL.md": skillMd("brand-new") });

  assert.match(run(fx, repo, "--update", "--dry-run"), /brand-new/);
});

test("--skip removes that source and --dry-run writes nothing", () => {
  const fx = fixtures();
  const repo = makeRepo();
  run(fx, repo);

  run(fx, repo, "--skip", "ecc");
  assert.ok(!existsSync(join(repo, ".github/skills/ecc-golang-testing")));
  assert.ok(existsSync(join(repo, ".github/skills/pocock-tdd")));

  const fresh = makeRepo();
  const out = run(fx, fresh, "--dry-run");
  assert.match(out, /pocock-tdd/);
  assert.ok(!existsSync(join(fresh, ".github")));
});
