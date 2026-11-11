import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildRewrites, githubBlobBase, rewriteLinks, rewriteReferences } from "../lib/rewrite.mjs";

const names = new Map([
  ["tdd", "pocock-tdd"],
  ["grilling", "pocock-grilling"],
  ["research", "pocock-research"],
  ["code-review", "pocock-code-review"],
]);

test("prefixes slash commands but not paths, URLs or longer names", () => {
  const text = "Run /tdd or (/code-review). See docs/research/x.md, https://x.test/tdd, /tdd-workflow and ~/tdd.";
  assert.equal(
    rewriteReferences(text, names),
    "Run /pocock-tdd or (/pocock-code-review). See docs/research/x.md, https://x.test/tdd, /tdd-workflow and ~/tdd.",
  );
});

test("prefixes names that are explicitly skills, agents or Skill tool arguments", () => {
  assert.equal(rewriteReferences("Is the `research` skill installed?", names), "Is the `pocock-research` skill installed?");
  assert.equal(rewriteReferences("See skill: `tdd` for patterns.", names), "See skill: `pocock-tdd` for patterns.");
  assert.equal(
    rewriteReferences('Call the Skill tool twice, for "grilling" and `tdd`.', names),
    'Call the Skill tool twice, for "pocock-grilling" and `pocock-tdd`.',
  );
});

test("leaves bare backticked words alone because sources use them as labels", () => {
  const text = "Each ticket carries a label, one of `research`, `grilling`, `task`. For each `research` ticket, fire a subagent.";
  assert.equal(rewriteReferences(text, names), text);
});

test("on a Skill tool line, only names after the Skill tool mention are rewritten", () => {
  assert.equal(
    rewriteReferences("For each `research` ticket, spin up a subagent that calls the Skill tool with `research`.", names),
    "For each `research` ticket, spin up a subagent that calls the Skill tool with `pocock-research`.",
  );
});

test("points a link into a sibling skill at its installed folder and keeps the anchor", () => {
  const out = rewriteLinks("See [grilling](../../productivity/grilling/SKILL.md#rules).", {
    fileDir: "skills/engineering/tdd",
    ownDir: "skills/engineering/tdd",
    installedDir: ".github/skills/pocock-tdd",
    skillDirs: new Map([["skills/productivity/grilling", "pocock-grilling"], ["skills/engineering/tdd", "pocock-tdd"]]),
    webBase: null,
  });
  assert.equal(out, "See [grilling](../pocock-grilling/SKILL.md#rules).");
});

test("points links to upstream files that are not installed at GitHub, and leaves local and external links alone", () => {
  const text = [
    "Rules: [hooks](../../rules/react/hooks.md) and [dir](../../rules/react/).",
    "Local: [ref](./reference.md), [anchor](#top), [web](https://example.test/a), [abs](/x).",
    "[def]: ../../rules/react/testing.md",
    "Escapes: [up](../../../../outside.md)",
  ].join("\n");
  const out = rewriteLinks(text, {
    fileDir: "skills/react-patterns",
    ownDir: "skills/react-patterns",
    installedDir: ".github/skills/ecc-react-patterns",
    skillDirs: new Map(),
    webBase: "https://github.com/o/r/blob/v1.0.0",
  });
  assert.equal(
    out,
    [
      "Rules: [hooks](https://github.com/o/r/blob/v1.0.0/rules/react/hooks.md) and [dir](https://github.com/o/r/blob/v1.0.0/rules/react/).",
      "Local: [ref](./reference.md), [anchor](#top), [web](https://example.test/a), [abs](/x).",
      "[def]: https://github.com/o/r/blob/v1.0.0/rules/react/testing.md",
      "Escapes: [up](../../../../outside.md)",
    ].join("\n"),
  );
});

test("leaves links to files that are not installed unchanged when the source is not on GitHub", () => {
  const text = "[hooks](../../rules/react/hooks.md)";
  const out = rewriteLinks(text, { fileDir: "skills/x", ownDir: "skills/x", installedDir: ".github/skills/a-x", skillDirs: new Map(), webBase: null });
  assert.equal(out, text);
});

test("only github.com HTTPS repos get a blob URL", () => {
  assert.equal(githubBlobBase("https://github.com/affaan-m/ECC", "v2.2.3"), "https://github.com/affaan-m/ECC/blob/v2.2.3");
  assert.equal(githubBlobBase("https://github.com/o/r.git", "v1.0.0"), "https://github.com/o/r/blob/v1.0.0");
  assert.equal(githubBlobBase("file:///tmp/r", "v1.0.0"), null);
  assert.equal(githubBlobBase("https://github.com/o/r", undefined), null);
});

test("builds per-source maps from the plan, so references never cross sources", () => {
  const root = join("/", "cache", "pocock");
  const rw = buildRewrites(
    {
      entries: [
        { source: "pocock", originalName: "tdd", dest: "pocock-tdd", srcDir: join(root, "skills", "engineering", "tdd") },
        { source: "ecc", originalName: "golang-testing", dest: "ecc-golang-testing", srcDir: join("/", "cache", "ecc", "skills", "golang-testing") },
      ],
      agentEntries: [{ source: "ecc", originalName: "go-reviewer", dest: "ecc-go-reviewer", srcFile: join("/", "cache", "ecc", "agents", "go-reviewer.md") }],
    },
    [
      { id: "pocock", root, repo: "https://github.com/mattpocock/skills", tag: "v1.3.2" },
      { id: "ecc", root: join("/", "cache", "ecc"), repo: "file:///ecc", tag: "v2.2.3" },
    ],
  );
  assert.deepEqual([...rw.pocock.names], [["tdd", "pocock-tdd"]]);
  assert.deepEqual([...rw.pocock.skillDirs], [["skills/engineering/tdd", "pocock-tdd"]]);
  assert.equal(rw.pocock.webBase, "https://github.com/mattpocock/skills/blob/v1.3.2");
  assert.deepEqual([...rw.ecc.names], [["golang-testing", "ecc-golang-testing"], ["go-reviewer", "ecc-go-reviewer"]]);
  assert.equal(rw.ecc.webBase, null);
});
