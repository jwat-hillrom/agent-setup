import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addTag, git, makeRemote, tempDir } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

function toolRemote() {
  const remote = makeRemote({});
  for (const entry of ["agent-setup.mjs", "lib"]) cpSync(join(ROOT, entry), join(remote, entry), { recursive: true });
  addTag(remote, "v0.0.1", {});
  return remote;
}

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
  execFileSync("powershell", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "NEWER.txt")));
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
  execFileSync("bash", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "NEWER.txt")));
  assert.equal(git(toolDir, "status", "--porcelain"), "");
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
