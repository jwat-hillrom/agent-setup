# agent-setup

Sets up a repository for AI-assisted work in VS Code Copilot Chat. It installs a curated set of skills and agents into the repo's `.github/` folder and keeps them out of git.

| Source | Prefix | What is installed |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | `pocock-` | every shipped skill (owns the workflow) |
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | `ecc-` | only the skills and agents on the allowlists in [config.json](./config.json) |
| [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) | `taste-` | `design-taste-frontend` |
| [jwat-hillrom/agent-skills](https://github.com/jwat-hillrom/agent-skills) (private) | `baxter-` | every shipped Baxter skill, e.g. `/baxter-nexus-design-compliance` |

## Install on a new workstation

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jwat-hillrom/agent-setup/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/jwat-hillrom/agent-setup/main/install.sh | bash
```

The installer checks Git and Node 18+ (on confirmation it installs them with winget or Homebrew; on Linux it tells you what to install), clones this tool to a per-user folder, and adds an `agent-setup` command. Re-running it updates everything. If your security tooling blocks piping a script into the shell, download `install.ps1` or `install.sh` and run it directly.

The Taste skill's own scripts need Node 22+ and Chrome, Edge or Chromium.

## Use

```sh
cd <your-repo>
agent-setup
```

Then run `/pocock-setup-matt-pocock-skills` once in the repo. The command pulls its own clone first (quietly, and it carries on if offline), so the tool stays current.

On first run you may be asked to sign in to GitHub: the Baxter skills come from a private repository. If that source can't be fetched (no access, offline), it is skipped with a warning and anything it installed earlier is kept. Every other source is required and stops the run before anything is written.

Options: `--repo <dir>`, `--skip <id,...>` (removes that source's items), `--update`, `--dry-run`, `--uninstall`, `--no-self-update`, `--cache-dir <dir>`.

## How it behaves

- Skills are copied to `.github/skills/<prefix>-<name>` and agents to `.github/agents/<prefix>-<name>.agent.md`. Colons are not valid in skill names, so prefixes are hyphenated (`/pocock-wayfinder`).
- Each source is fetched at its latest stable release tag (`vX.Y.Z`). The tag is recorded in `.github/agent-setup.lock.json` (local to the machine) and reused until you pass `--update`, which also lists new upstream ECC skills and agents that are not on the allowlists.
- Everything installed, the lock file and `.github/instructions/agent-setup.instructions.md` are excluded through a managed block in `.git/info/exclude`, so `git status` stays clean. `.taste-skill/` is excluded too. Folders matching `.github/skills/<prefix>-*` are reserved for this tool; a same-named item it did not create is left alone with a warning.
- ECC agents keep only `name`, `description` and `tools`. Claude tool names are mapped to Copilot aliases (`Read` to `read`, `Grep`/`Glob` to `search`, `Bash` to `execute`, `Edit`/`Write` to `edit`), `model` is dropped, and "MUST BE USED" / "PROACTIVELY" sentences are removed from descriptions so ECC agents do not compete with the Pocock flow. ECC rules are not installed.
- `agent-setup.instructions.md` tells the agent how the sources relate: repo docs first, Pocock owns the workflow, ECC adds depth, Baxter is authoritative for Nexus UI over Taste, and a bare skill name inside a skill means the prefixed one.
- If the same skills are also installed as user-level VS Code plugins or in `~/.copilot/skills`, the tool warns because they will appear twice.

## Develop

```sh
node --test test/
```

Tests use local fixture git remotes and need no network (the installer tests also run `install.ps1` or `install.sh`; the shell one needs bash). `install.ps1` and `install.sh` must change together. Not covered by tests: the winget/Homebrew install paths for missing Git or Node.
