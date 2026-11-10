import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

export function tempDir(label = "agent-setup-test-") {
  return mkdtempSync(join(tmpdir(), label));
}

export function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function makeRepo(files = {}) {
  const dir = tempDir("agent-setup-repo-");
  git(dir, "init", "-q");
  writeTree(dir, files);
  return dir;
}

// A local git remote with one commit per tag, for tests that exercise fetching.
export function makeRemote(tags) {
  const dir = tempDir("agent-setup-remote-");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "tag.gpgsign", "false");
  for (const [tag, files] of Object.entries(tags)) addTag(dir, tag, files);
  return dir;
}

export function addTag(remoteDir, tag, files) {
  writeTree(remoteDir, files);
  git(remoteDir, "add", "-A");
  git(remoteDir, "commit", "-q", "-m", tag, "--allow-empty");
  git(remoteDir, "tag", tag);
}
