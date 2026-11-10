# Working in this repo

A dependency-free Node ESM tool (`agent-setup.mjs`, `lib/`) plus two installers (`install.ps1`, `install.sh`). Behavior and options are in `README.md`.

- Run `node --test test/` before committing. Tests use local fixture git remotes; keep them network-free. Add a test at the plan, apply, release-selection, CLI or installer seam before changing behavior there.
- Node standard library only, `node:path` for paths, so it runs on Windows, macOS and Linux.
- `install.ps1` and `install.sh` do the same job; change both together.
- Sources, the ECC allowlists and ignore patterns live in `config.json`. After bumping an allowlist, run `agent-setup --dry-run` against a scratch repo and read the warnings for names that no longer exist upstream.
- `agent-setup.instructions.md` is copied into every target repo. Keep it short and keep it describing precedence only.
- The Baxter source is fetched by release tag, so skill changes in `jwat-hillrom/agent-skills` only reach users after a `vX.Y.Z` tag is pushed there.
