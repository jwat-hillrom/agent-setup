import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseLsRemoteTags, pickLatestRelease } from "./release.mjs";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function resolveLatestTag(repoUrl) {
  const tag = pickLatestRelease(parseLsRemoteTags(git(["ls-remote", "--tags", "--", repoUrl])));
  if (!tag) throw new Error(`no stable release tag found in ${repoUrl}`);
  return tag;
}

export function fetchTag(repoUrl, tag, cacheDir, id) {
  const key = createHash("sha1").update(repoUrl).digest("hex").slice(0, 8);
  const dir = join(cacheDir, `${id}-${key}-${tag}`);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(cacheDir, { recursive: true });
    git(["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, "--", repoUrl, dir]);
  }
  return { dir, sha: git(["rev-parse", "HEAD"], dir) };
}
