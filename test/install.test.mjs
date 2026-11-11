import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addTag, git, makeRemote, tempDir, writeTree } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";
const POWERSHELL = WINDOWS ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell";

function toolRemote() {
  const remote = makeRemote({});
  for (const entry of ["agent-setup.mjs", "lib"]) cpSync(join(ROOT, entry), join(remote, entry), { recursive: true });
  addTag(remote, "v0.0.1", {});
  return remote;
}

function commitUntagged(remote, files) {
  writeTree(remote, files);
  git(remote, "add", "-A");
  git(remote, "commit", "-q", "-m", "untagged");
}

// Stub commands that stand in for winget/brew and an outdated Node until the "installer" has run.
function stubs(files) {
  const dir = tempDir("agent-setup-stubs-");
  writeTree(dir, files);
  for (const name of Object.keys(files)) chmodSync(join(dir, name), 0o755);
  return dir;
}

const shStub = (body) => `#!/bin/sh\n${body}\n`;

// On Windows `bash` may be WSL's launcher, which cannot run these scripts.
const hasBash = spawnSync("bash", ["-c", "git --version"], { stdio: "ignore" }).status === 0;

test("install.ps1 clones the tool, writes a shim that runs it even from an awkward path, and is safe to re-run", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const toolDir = join(tempDir("agent-setup-inst-"), "a b 50%done", "tool");
  const binDir = join(tempDir("agent-setup-bin-"), "bin dir");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", toolDir, "-BinDir", binDir, "-Repo", remote, "-Yes", "-NoPath"];

  execFileSync("powershell", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "agent-setup.mjs")));
  const help = execFileSync("cmd", ["/c", join(binDir, "agent-setup.cmd"), "--help"], { encoding: "utf8" });
  assert.match(help, /Usage: agent-setup/);

  addTag(remote, "v0.0.2", { "NEWER.txt": "x\n" });
  commitUntagged(remote, { "UNRELEASED.txt": "x\n" });
  execFileSync("powershell", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "NEWER.txt")));
  assert.ok(!existsSync(join(toolDir, "UNRELEASED.txt")), "untagged commit installed");
  assert.equal(git(toolDir, "config", "--get", "agent-setup.install"), "true");
});

test("install.ps1 installs Node with winget when the installed one is too old", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const bin = stubs({
    "node.cmd": `@echo off\r\nif not exist "%~dp0upgraded" goto old\r\n"${process.execPath}" %*\r\nexit /b %errorlevel%\r\n:old\r\necho 18.20.0\r\n`,
    "winget.cmd": `@echo off\r\necho %*>>"%~dp0winget.log"\r\ntype nul > "%~dp0upgraded"\r\n`,
  });
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");
  const binDir = tempDir("agent-setup-bin-");
  const env = { ...process.env, PATH: `${bin};${process.env.PATH}` };

  execFileSync(POWERSHELL, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", toolDir, "-BinDir", binDir, "-Repo", remote, "-Yes", "-NoPath"], { encoding: "utf8", env });

  assert.match(readFileSync(join(bin, "winget.log"), "utf8"), /install --id OpenJS\.NodeJS\.LTS -e/);
  assert.ok(existsSync(join(binDir, "agent-setup.cmd")));
});

test("install.ps1 stops with a clear message when Node is too old and winget is unavailable", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const bin = stubs({ "node.cmd": "@echo off\r\necho 18.20.0\r\n" });
  const gitDir = dirname(execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/)[0].trim());
  const env = { ...process.env, PATH: [bin, gitDir, join(process.env.SystemRoot, "System32")].join(";") };

  const r = spawnSync(POWERSHELL, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", join(tempDir("agent-setup-inst-"), "tool"), "-BinDir", tempDir("agent-setup-bin-"), "-Repo", remote, "-Yes", "-NoPath"], { encoding: "utf8", env });

  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /winget is not available/);
});

test("install.ps1 appends the bin folder to the user PATH once and keeps %VARS% unexpanded", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const keyName = `agent-setup-test-${process.pid}`;
  const key = `HKCU:\\Software\\${keyName}`;
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");
  const binDir = tempDir("agent-setup-bin-");
  const ps = (command) => execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", toolDir, "-BinDir", binDir, "-Repo", remote, "-Yes"];
  ps(`New-Item -Path '${key}' -Force | Out-Null; New-ItemProperty -Path '${key}' -Name Path -Value '%USERPROFILE%\\mybin;C:\\x\\' -PropertyType ExpandString | Out-Null`);
  try {
    const env = { ...process.env, AGENT_SETUP_ENV_KEY: key };
    execFileSync("powershell", args, { encoding: "utf8", env });
    execFileSync("powershell", args, { encoding: "utf8", env });
    const raw = ps(`(Get-Item -LiteralPath '${key}').GetValue('Path','','DoNotExpandEnvironmentNames')`);
    assert.equal(raw, `%USERPROFILE%\\mybin;C:\\x\\;${binDir}`);
  } finally {
    ps(`Remove-Item -LiteralPath '${key}' -Recurse -Force`);
  }
});

test("install.ps1 keeps going when the existing tool clone cannot fast-forward", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");
  const binDir = tempDir("agent-setup-bin-");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", toolDir, "-BinDir", binDir, "-Repo", remote, "-Yes", "-NoPath"];
  execFileSync("powershell", args, { encoding: "utf8" });
  git(toolDir, "config", "user.email", "t@example.com");
  git(toolDir, "config", "user.name", "t");
  git(toolDir, "config", "commit.gpgsign", "false");
  git(toolDir, "commit", "-q", "--allow-empty", "-m", "local");
  addTag(remote, "v0.0.2", { "NEWER.txt": "x\n" });

  const r = spawnSync("powershell", args, { encoding: "utf8" });

  assert.equal(r.status, 0);
  assert.ok(existsSync(join(binDir, "agent-setup.cmd")));
});

test("install.sh clones the tool, writes a shim that survives shell metacharacters in the path, and is safe to re-run", { skip: !hasBash && "bash not available" }, () => {
  const remote = toolRemote();
  const toolDir = join(tempDir("agent-setup-inst-"), "a b$HOME'x", "tool");
  const binDir = join(tempDir("agent-setup-bin-"), "bin dir");
  const args = [join(ROOT, "install.sh"), "--tool-dir", toolDir, "--bin-dir", binDir, "--repo", remote, "--yes", "--no-path"];

  execFileSync("bash", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "agent-setup.mjs")));
  const help = execFileSync("bash", [join(binDir, "agent-setup"), "--help"], { encoding: "utf8" });
  assert.match(help, /Usage: agent-setup/);

  addTag(remote, "v0.0.2", { "NEWER.txt": "x\n" });
  commitUntagged(remote, { "UNRELEASED.txt": "x\n" });
  execFileSync("bash", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "NEWER.txt")));
  assert.ok(!existsSync(join(toolDir, "UNRELEASED.txt")), "untagged commit installed");
  assert.equal(git(toolDir, "config", "--get", "agent-setup.install"), "true");
  assert.equal(git(toolDir, "status", "--porcelain"), "");
});

// Puts the stub folder first on PATH inside bash (Git Bash on Windows needs a POSIX path for that).
function bashWithStubs(bin, script, args, extraEnv = {}) {
  const prelude = 'S=$(cygpath -u "$STUBS" 2>/dev/null || printf %s "$STUBS"); PATH="$S:$PATH" exec bash "$@"';
  return spawnSync("bash", ["-c", prelude, "bash", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, STUBS: bin, REAL_NODE: process.execPath, ...extraEnv },
  });
}

test("install.sh installs Git and Node with Homebrew on macOS when Node is too old", { skip: !hasBash && "bash not available" }, () => {
  const remote = toolRemote();
  const bin = stubs({
    uname: shStub("echo Darwin"),
    brew: shStub('echo "$*" >> "$STUBS/brew.log"; touch "$STUBS/upgraded"'),
    node: shStub('if [ -f "$STUBS/upgraded" ]; then exec "$REAL_NODE" "$@"; fi\necho 18'),
  });
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");

  const r = bashWithStubs(bin, join(ROOT, "install.sh"), ["--tool-dir", toolDir, "--bin-dir", tempDir("agent-setup-bin-"), "--repo", remote, "--yes", "--no-path"]);

  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(bin, "brew.log"), "utf8"), /^install git node$/m);
  assert.ok(existsSync(join(toolDir, "agent-setup.mjs")));
});

test("install.sh on Linux explains how to get Node when it is too old, then stops", { skip: !hasBash && "bash not available" }, () => {
  const remote = toolRemote();
  const bin = stubs({ uname: shStub("echo Linux"), node: shStub("echo 18") });
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");

  const r = bashWithStubs(bin, join(ROOT, "install.sh"), ["--tool-dir", toolDir, "--bin-dir", tempDir("agent-setup-bin-"), "--repo", remote, "--yes", "--no-path"]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Node 20 or newer are required[\s\S]*nvm/);
  assert.ok(!existsSync(toolDir));
});

test("install.sh adds the bin folder to the shell profile once, however often it runs", { skip: !hasBash && "bash not available" }, () => {
  const remote = toolRemote();
  const home = tempDir("agent-setup-home-");
  mkdirSync(home, { recursive: true });
  const binDir = join(tempDir("agent-setup-bin-"), "bin");
  const args = [join(ROOT, "install.sh"), "--tool-dir", join(home, "tool"), "--bin-dir", binDir, "--repo", remote, "--yes"];
  const env = { ...process.env, HOME: home, SHELL: "/bin/bash" };

  execFileSync("bash", args, { encoding: "utf8", env });
  execFileSync("bash", args, { encoding: "utf8", env });

  const profile = [".bashrc", ".bash_profile"].map((f) => join(home, f)).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.equal(profile.split("\n").filter((l) => l.includes("export PATH") && l.includes("bin")).length, 1);
});
