import { execFileSync, spawnSync } from "node:child_process";
import { pickLatestRelease } from "./release.mjs";

// Set by install.ps1 / install.sh on the clone they manage. Development clones never have it.
export const INSTALL_MARKER = "agent-setup.install";

const quiet = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } };

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], quiet).trim();

// `--show-cdup` is empty only at the top of a work tree; comparing paths instead breaks on
// Windows 8.3 short names (C:\Users\RUNNER~1) and symlinked folders.
export function isInstallClone(dir) {
  try {
    return git(dir, "rev-parse", "--show-cdup") === "" && git(dir, "config", "--get", INSTALL_MARKER) === "true";
  } catch {
    return false;
  }
}

// Moves an installed clone to the newest release tag (vX.Y.Z); returns true only when it moved.
// Untagged commits on the default branch never reach installs. Never throws.
export function selfUpdate(toolDir) {
  try {
    if (!isInstallClone(toolDir)) return false;
    git(toolDir, "fetch", "--quiet", "--force", "--depth", "1", "origin", "+refs/tags/*:refs/tags/*");
    const tag = pickLatestRelease(git(toolDir, "tag", "--list").split(/\r?\n/));
    if (!tag) return false;
    const target = git(toolDir, "rev-parse", `${tag}^{commit}`);
    if (target === git(toolDir, "rev-parse", "HEAD")) return false;
    git(toolDir, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", tag);
    return git(toolDir, "rev-parse", "HEAD") === target;
  } catch {
    return false;
  }
}

// Replaces this process with a fresh run of the (now updated) script.
export function rerun(argv) {
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: { ...process.env, AGENT_SETUP_UPDATED: "1" } });
  process.exit(r.status ?? 1);
}
