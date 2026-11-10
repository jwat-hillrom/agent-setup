import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLatestRelease, parseLsRemoteTags } from "../lib/release.mjs";

test("picks the highest stable semver tag", () => {
  assert.equal(pickLatestRelease(["v1.2.3", "v1.10.0", "v1.9.9"]), "v1.10.0");
});

test("ignores prereleases and non-version tags", () => {
  const tags = ["v2.0.0-rc.1", "mattpocock-skills@1.0.0", "nightly", "v1.3.2"];
  assert.equal(pickLatestRelease(tags), "v1.3.2");
});

test("returns null when no stable tag exists", () => {
  assert.equal(pickLatestRelease(["v2.0.0-rc.1", "latest"]), null);
});

test("parses `git ls-remote --tags` output, dropping peeled duplicates", () => {
  const out = [
    "aaa\trefs/tags/v1.0.0",
    "bbb\trefs/tags/v1.0.0^{}",
    "ccc\trefs/tags/mattpocock-skills@1.0.0",
    "",
  ].join("\n");
  assert.deepEqual(parseLsRemoteTags(out), ["v1.0.0", "mattpocock-skills@1.0.0"]);
});
