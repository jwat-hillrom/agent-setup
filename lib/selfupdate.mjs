import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const quiet = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } };

const head = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], quiet).trim();

// Pulls the tool's own clone; returns true only when new commits arrived. Never throws.
export function selfUpdate(toolDir) {
  try {
    const top = execFileSync("git", ["-C", toolDir, "rev-parse", "--show-toplevel"], quiet).trim();
    if (resolve(top) !== resolve(toolDir)) return false;
    const before = head(toolDir);
    execFileSync("git", ["-C", toolDir, "pull", "--ff-only", "--quiet"], quiet);
    return head(toolDir) !== before;
  } catch {
    return false;
  }
}

// Replaces this process with a fresh run of the (now updated) script.
export function rerun(argv) {
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: { ...process.env, AGENT_SETUP_UPDATED: "1" } });
  process.exit(r.status ?? 1);
}
