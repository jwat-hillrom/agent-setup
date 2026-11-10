import { test } from "node:test";
import assert from "node:assert/strict";
import { planInstall, rewriteSkillName } from "../lib/plan.mjs";

const skill = (name, dir = `/src/${name}`) => ({ name, dir });

test("prefixes every skill with its source prefix", () => {
  const { entries } = planInstall([
    { id: "pocock", prefix: "pocock", skills: [skill("tdd"), skill("wayfinder")] },
  ]);
  assert.deepEqual(
    entries.map((e) => [e.source, e.originalName, e.dest]),
    [
      ["pocock", "tdd", "pocock-tdd"],
      ["pocock", "wayfinder", "pocock-wayfinder"],
    ],
  );
});

test("plan entries carry the source prefix and source directory", () => {
  const { entries } = planInstall([{ id: "taste", prefix: "taste", skills: [skill("design-taste-frontend", "/src/skills/taste-skill")] }]);
  assert.equal(entries[0].prefix, "taste");
  assert.equal(entries[0].srcDir, "/src/skills/taste-skill");
  assert.equal(entries[0].dest, "taste-design-taste-frontend");
});

test("plans prefixed agent files from the agent include list and warns about missing names", () => {
  const { agentEntries, warnings } = planInstall([
    {
      id: "ecc",
      prefix: "ecc",
      skills: [],
      agents: [{ name: "go-reviewer", file: "/src/go-reviewer.md" }, { name: "planner", file: "/src/planner.md" }],
      agentInclude: ["go-reviewer", "gone-agent"],
    },
  ]);
  assert.deepEqual(agentEntries, [
    { source: "ecc", prefix: "ecc", originalName: "go-reviewer", srcFile: "/src/go-reviewer.md", dest: "ecc-go-reviewer" },
  ]);
  assert.match(warnings.join("\n"), /gone-agent/);
});

test("rejects two agents that land on the same destination", () => {
  const agents = [{ name: "x", file: "/x.md" }];
  assert.throws(
    () => planInstall([{ id: "a", prefix: "p", skills: [], agents }, { id: "b", prefix: "p", skills: [], agents }]),
    /p-x/,
  );
});

test("collects ignore patterns declared by sources", () => {
  const { ignore } = planInstall([
    { id: "taste", prefix: "taste", skills: [], ignore: [".taste-skill/"] },
    { id: "ecc", prefix: "ecc", skills: [] },
  ]);
  assert.deepEqual(ignore, [".taste-skill/"]);
});

test("include list keeps only named skills and warns about names missing upstream", () => {
  const { entries, warnings } = planInstall([
    {
      id: "ecc",
      prefix: "ecc",
      include: ["golang-testing", "gone-skill"],
      skills: [skill("golang-testing"), skill("tdd-workflow")],
    },
  ]);
  assert.deepEqual(entries.map((e) => e.dest), ["ecc-golang-testing"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gone-skill/);
});

test("rejects destination names that are not valid skill names", () => {
  assert.throws(
    () => planInstall([{ id: "x", prefix: "x", skills: [skill("Bad_Name")] }]),
    /x-Bad_Name/,
  );
  assert.throws(
    () => planInstall([{ id: "x", prefix: "x", skills: [skill("a".repeat(64))] }]),
    /64/,
  );
});

test("rejects two skills that land on the same destination", () => {
  assert.throws(
    () =>
      planInstall([
        { id: "a", prefix: "p", skills: [skill("tdd")] },
        { id: "b", prefix: "p", skills: [skill("tdd")] },
      ]),
    /p-tdd/,
  );
});

test("rewriteSkillName renames the frontmatter name and leaves the body alone", () => {
  const md = "---\nname: design-taste-frontend\ndescription: x\n---\n# name: keep me\n";
  assert.equal(
    rewriteSkillName(md, "taste-design-taste-frontend"),
    "---\nname: taste-design-taste-frontend\ndescription: x\n---\n# name: keep me\n",
  );
});

test("rewriteSkillName adds a name line when the frontmatter has none", () => {
  const md = "---\ndescription: x\n---\nbody\n";
  assert.equal(rewriteSkillName(md, "ecc-foo"), "---\nname: ecc-foo\ndescription: x\n---\nbody\n");
});

test("rewriteSkillName handles quoted names and CRLF line endings", () => {
  const md = '---\r\nname: "tdd"\r\ndescription: x\r\n---\r\nbody\r\n';
  assert.equal(
    rewriteSkillName(md, "pocock-tdd"),
    '---\r\nname: pocock-tdd\r\ndescription: x\r\n---\r\nbody\r\n',
  );
});
