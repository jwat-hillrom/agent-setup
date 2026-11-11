# Working in this repo

A dependency-free Node ESM tool (`agent-setup.mjs`, `lib/`) plus two installers (`install.ps1`, `install.sh`). Behavior and options are in `README.md`.

- Run `node --test test/` before committing. Tests use local fixture git remotes; keep them network-free. Add a test at the plan, apply, release-selection, CLI or installer seam before changing behavior there.
- Node standard library only, `node:path` for paths, so it runs on Windows, macOS and Linux.
- `install.ps1` and `install.sh` do the same job; change both together.
- Sources, their pinned release tags, the ECC allowlists and ignore patterns live in `config.json`. Change pins with `node agent-setup.mjs --bump`, not by hand. After a bump or an allowlist change, run `agent-setup --dry-run` against a scratch repo and read the warnings for names that no longer exist upstream.
- `agent-setup.instructions.md` is copied into every target repo. Keep it short and keep it describing precedence only.
- The Baxter source is pinned like the others, so a skill change in `jwat-hillrom/agent-skills` reaches users only after a `vX.Y.Z` tag there, a `--bump` here, and an agent-setup release.
- Workstations run whatever the newest `vX.Y.Z` tag of this repo points at (see README "Release"). Tag only commits that passed CI on `main`; tags are immutable, so fix forward with a higher version.
