---
applyTo: "**"
description: Which installed skill source owns which part of the agent workflow in this repo.
---

# Agent workflow precedence

Skills and agents installed by `agent-setup` carry a source prefix: `pocock-`, `ecc-`, `taste-`, `baxter-`. Slash commands use the prefixed name (for example `/pocock-wayfinder`). When a skill or agent refers to another skill or agent by its bare name (for example "call the Skill tool with `tdd`" or "see skill `golang-patterns`"), use the prefixed one from the same source (`pocock-tdd`, `ecc-golang-patterns`).

When sources overlap, follow this order:

1. **This repo's own docs win.** `AGENTS.md`, `GLOSSARY.md`, `docs/adr/` and `docs/agents/` (issue tracker, triage labels, domain-doc layout) override every skill.
2. **Pocock skills own the workflow:** align (`pocock-grill-with-docs`, `pocock-grilling`), capture (`pocock-to-spec`, `pocock-to-tickets`, `pocock-triage`, `pocock-wayfinder`), build (`pocock-implement`, `pocock-implement-spec`, `pocock-tdd`), debug (`pocock-diagnosing-bugs`), design (`pocock-codebase-design`, `pocock-domain-modeling`), review (`pocock-code-review`), and PR bodies (`pocock-pr`).
3. **ECC adds specialist depth inside those steps and never replaces them.** Language, framework, testing, security and deployment skills (`ecc-*`) supply stack knowledge to `pocock-tdd`, `pocock-implement` and `pocock-code-review`. ECC agents (`ecc-go-reviewer`, `ecc-security-reviewer`, `ecc-go-build-resolver`, and similar) are specialist reviewers and build fixers: use them as the Standards reviewers inside `pocock-code-review` or to fix a failing build, not as a separate review or planning flow.
4. **Baxter skills are authoritative in their domain.** For Baxter UI, `baxter-nexus-design-compliance` and the Nexus tokens win over `taste-design-taste-frontend`: do not apply Taste palettes, fonts or layout rules where Nexus specifies them.

Do not:

- Run an ECC planning, orchestration or "auto-delegate" flow in place of the Pocock flow above.
- Write specs, tickets, ADRs or glossary entries anywhere other than the locations in `docs/agents/`.
- Treat ECC numeric targets (coverage percentages, function length limits) as repo policy unless `AGENTS.md` adopts them.
