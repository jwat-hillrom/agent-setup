import { test } from "node:test";
import assert from "node:assert/strict";
import { convertAgent } from "../lib/agents.mjs";

const upstream = [
  "---",
  "name: go-reviewer",
  "description: Expert Go code reviewer. Use for all Go code changes. MUST BE USED for Go projects.",
  "tools: Read, Grep, Glob, Bash",
  "model: sonnet",
  "---",
  "",
  "You are a senior Go reviewer.",
  "",
].join("\n");

test("keeps the body, renames the agent and drops Claude-only fields", () => {
  const out = convertAgent(upstream, "ecc-go-reviewer");
  assert.match(out, /^---\nname: ecc-go-reviewer\n/);
  assert.doesNotMatch(out, /^model:/m);
  assert.ok(out.endsWith("\n---\n\nYou are a senior Go reviewer.\n"));
});

test("maps Claude tool names to Copilot tool aliases and drops unknown tools", () => {
  const md = upstream.replace("Read, Grep, Glob, Bash", "Read, Grep, Glob, Edit, Write, WebFetch, Task, TodoWrite, mcp__x__y");
  assert.match(convertAgent(md, "ecc-x"), /^tools: \['read', 'search', 'edit', 'web', 'agent', 'todo'\]$/m);
  assert.match(convertAgent(upstream, "ecc-x"), /^tools: \['read', 'search', 'execute'\]$/m);
});

test("removes always-use directives from the description so agents do not compete with the Pocock flow", () => {
  const out = convertAgent(upstream, "ecc-go-reviewer");
  assert.match(out, /^description: "Expert Go code reviewer\. Use for all Go code changes\."$/m);
});

test("omits tools when the upstream agent declares none", () => {
  const md = upstream.replace("tools: Read, Grep, Glob, Bash\n", "");
  assert.doesNotMatch(convertAgent(md, "ecc-x"), /^tools:/m);
});

test("uses the source file's line endings for the rewritten header", () => {
  const out = convertAgent(upstream.replace(/\n/g, "\r\n"), "ecc-x");
  assert.equal(out.replace(/\r\n/g, "").includes("\n"), false);
});

test("always writes a valid quoted description, even when the upstream one is quoted or contains colons", () => {
  const quoted = upstream.replace(/^description:.*$/m, 'description: "Reviewer: checks Go. Use PROACTIVELY."');
  assert.match(convertAgent(quoted, "ecc-x"), /^description: "Reviewer: checks Go\."$/m);
  const plain = upstream.replace(/^description:.*$/m, "description: Fixes build errors: minimal diffs # fast");
  assert.match(convertAgent(plain, "ecc-x"), /^description: "Fixes build errors: minimal diffs # fast"$/m);
});

test("keeps the original description when every sentence is an always-use directive", () => {
  const md = upstream.replace(/^description:.*$/m, "description: MUST BE USED for Go.");
  assert.match(convertAgent(md, "ecc-x"), /^description: "MUST BE USED for Go\."$/m);
});

test("does not split descriptions on abbreviations or drop lowercase 'proactively'", () => {
  const md = upstream.replace(/^description:.*$/m, "description: Reviews code, e.g. Go and proactively flags races. MUST BE USED.");
  assert.match(convertAgent(md, "ecc-x"), /^description: "Reviews code, e\.g\. Go and proactively flags races\."$/m);
});

test("falls back to read-only tools when the declared tools do not map, and ignores inherited object keys", () => {
  const unmapped = upstream.replace("Read, Grep, Glob, Bash", "mcp__x__y, constructor, toString");
  assert.match(convertAgent(unmapped, "ecc-x"), /^tools: \['read', 'search'\]$/m);
});

test("tolerates a BOM and does not treat '----' as the end of the frontmatter", () => {
  const md = "\uFEFF" + upstream.replace("model: sonnet", "model: sonnet\n----").replace("\nYou are", "\n----\nYou are");
  const out = convertAgent(md, "ecc-x");
  assert.match(out, /^---\nname: ecc-x\n/);
  assert.ok(out.includes("You are a senior Go reviewer."));
});

test("accepts tools written as a YAML list", () => {
  const md = upstream.replace("tools: Read, Grep, Glob, Bash", "tools: [\"Read\", \"Bash\"]");
  assert.match(convertAgent(md, "ecc-x"), /^tools: \['read', 'execute'\]$/m);
});
