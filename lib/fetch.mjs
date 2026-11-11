import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseLsRemoteTags, pickLatestRelease } from "./release.mjs";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();

export function resolveLatestTag(repoUrl) {
  const tag = pickLatestRelease(parseLsRemoteTags(git(["ls-remote", "--tags", "--", repoUrl])));
  if (!tag) throw new Error(`no stable release tag found in ${repoUrl}`);
  return tag;
}

export function fetchTag(repoUrl, tag, cacheDir, id) {
  const dir = join(cacheDir, `${cachePrefix(repoUrl, id)}${tag}`);
  if (!existsSync(join(dir, ".git"))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    git(["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, "--", repoUrl, dir]);
  }
  return { dir, sha: git(["rev-parse", "HEAD"], dir) };
}

const cachePrefix = (repoUrl, id) => `${id}-${createHash("sha1").update(repoUrl).digest("hex").slice(0, 8)}-`;

// Removes cached checkouts of this source at tags other than `keepTag`. Best effort.
export function pruneCache(repoUrl, keepTag, cacheDir, id) {
  const prefix = cachePrefix(repoUrl, id);
  if (!existsSync(cacheDir)) return;
  for (const name of readdirSync(cacheDir)) {
    if (name.startsWith(prefix) && name !== `${prefix}${keepTag}`) {
      try {
        rmSync(join(cacheDir, name), { recursive: true, force: true });
      } catch {
        // A locked file (e.g. an editor holding it open on Windows) only delays the cleanup.
      }
    }
  }
}
