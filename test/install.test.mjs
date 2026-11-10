import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync } from "node:fs";
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

const hasBash = !WINDOWS || spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

test("install.ps1 clones the tool, writes a shim that runs it, and is safe to re-run", { skip: !WINDOWS && "PowerShell installer is Windows only" }, () => {
  const remote = toolRemote();
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");
  const binDir = tempDir("agent-setup-bin-");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ToolDir", toolDir, "-BinDir", binDir, "-Repo", remote, "-Yes", "-NoPath"];

  execFileSync("powershell", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "agent-setup.mjs")));
  const help = execFileSync("cmd", ["/c", join(binDir, "agent-setup.cmd"), "--help"], { encoding: "utf8" });
  assert.match(help, /Usage: agent-setup/);

  addTag(remote, "v0.0.2", { "NEWER.txt": "x\n" });
  execFileSync("powershell", args, { encoding: "utf8" });
  assert.ok(existsSync(join(toolDir, "NEWER.txt")));
});

test("install.sh clones the tool, writes a shim that runs it, and is safe to re-run", { skip: !hasBash && "bash not available" }, () => {
  const remote = toolRemote();
  const toolDir = join(tempDir("agent-setup-inst-"), "tool");
  const binDir = tempDir("agent-setup-bin-");
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
