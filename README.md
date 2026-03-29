# Notion Operating System

Notion Operating System is a local automation layer for turning Notion into a real project and portfolio control system.

It started as a safe Markdown publishing toolkit for Notion, then grew into a broader system for publishing notes, maintaining project state, generating reviews, syncing external signals, and running governed workflows around Notion.

## Main Features

- Publish local Markdown and text files into the right Notion pages and databases
- Use friendly destination aliases instead of raw Notion IDs
- Validate writable Notion properties before any write
- Support dry-run first, then live publish when you are ready
- Create pages, update existing pages, replace page content, or patch targeted sections
- Maintain a Notion control tower for project and portfolio tracking
- Generate command-center pages, weekly reviews, and operating summaries
- Store rules, config, and workflow logic in code so the system is portable across machines

## Exciting Features

- Direct Markdown publishing into Notion through the REST API
- A real project operating system built on top of Notion, not just a note uploader
- Derived project signals like operating queues, review timing, and evidence freshness
- External telemetry lanes that can bring in signals from systems like GitHub
- Governed action flows that make automation auditable instead of ad hoc
- Config-driven behavior that makes the whole setup reproducible and versionable in GitHub

## Why You Would Want To Use It

- You want Notion to behave more like an operating system than a manual workspace
- You want repeatable publishing from local files instead of copy-pasting into Notion
- You want project reviews, summaries, and control pages to be generated consistently
- You want your PM logic, rules, and workflow memory stored in code, not trapped in one machine or one chat history
- You want a setup that can be cloned, versioned, audited, and rebuilt later

## What Exactly It Does

This project reads local content, resolves where that content belongs in Notion, validates the destination schema, and then safely creates or updates the target page.

On top of that, it manages a broader Notion-based project system: project databases, saved-view plans, weekly review packets, command-center pages, external signal mapping, governance rules, and rollout workflows.

In short, it is both:

- a reusable Notion publishing toolkit
- a code-backed operating system for running projects in Notion

## GitHub Install

Phase 10 makes the package installable from GitHub and GitHub release tarballs, while still keeping npm publishing out of scope.

For the core toolkit surface, you can install directly from GitHub:

```bash
npm install github:saagpatel/notion-operating-system#v0.2.0
```

That git-ref install works because the package now builds its distributable files during `prepare`. If you want the most locked-down install path, use the tarball attached to a GitHub release draft or release instead.

Then import the reusable toolkit pieces:

```ts
import { DestinationRegistry, Publisher, loadRuntimeConfig } from "notion-operating-system";
```

The `notion-operating-system/advanced` entrypoint still exists, but it is repo-specific and secondary to the public story in this phase.

## Consumer Install Modes

Use the install path that matches how much control you want:

- GitHub ref install: best when you want the package directly from a tagged GitHub ref
- GitHub release tarball install: best when you want the most locked-down verified artifact
- local repo development: best when you are working on the repo itself and want the full source-first workflow

Examples:

```bash
# GitHub ref install
npm install github:saagpatel/notion-operating-system#v0.2.0

# GitHub release tarball install
npm install https://github.com/saagpatel/notion-operating-system/releases/download/v0.2.0/notion-operating-system-0.2.0.tgz

# Local repo development
npm ci
```

## CLI

The canonical entrypoints are:

```bash
notion-os <command> [subcommand] [options]
tsx src/cli.ts <command> [subcommand] [options]
```

The shared CLI is the preferred operator surface. Older `npm run ...` scripts still work for compatibility, but the shared CLI keeps help text, flag parsing, runtime setup, and profile selection consistent across the main workflows.

You can explore the CLI with:

```bash
notion-os --help
notion-os --profile default doctor --help
tsx src/cli.ts --help
tsx src/cli.ts control-tower --help
npm run doctor -- --help
```

## Repo Governance

- `main` is a protected branch
- all changes should land by pull request
- required checks stay mandatory before merge
- required approval count is intentionally `0` for now because this is currently a solo-maintainer repo
- merge commits stay enabled so the structured phase history remains readable
- `npm run release:prepare` does not bypass CI; it is part of the release gate, not a replacement for it

## Most Common Commands

```bash
# Run the full local release gate
npm run verify

# Verify local setup on a new machine
npm run doctor

# Show the active workspace profile and resolved paths
notion-os profiles show

# Preview profile portability differences
notion-os profiles diff --against-profile default

# Clone a profile safely first
notion-os profiles clone --source default --target sandbox

# Inspect the most recent command runs
notion-os logs recent

# Check configured Notion destination aliases
npm run destinations:check

# Publish a file safely first
npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly.md --dry-run

# Publish live when ready
npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly.md --live

# Refresh the main control tower safely
notion-os control-tower sync

# Preview the weekly review packet
notion-os control-tower review-packet
```

Preferred npm aliases for common advanced workflows:

```bash
npm run control-tower:sync
npm run governance:audit
npm run signals:sync
npm run rollout:operational
```

Legacy `portfolio-audit:*` script names still work, but they are compatibility aliases now rather than the recommended default surface.

## Verification And Logs

Use the full local gate before shipping changes:

```bash
npm run verify
npm run release:prepare
```

This runs:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:built-cli`
- `npm run smoke:packed-install`
- `npm run smoke:git-install`

CI also verifies a fresh workspace copy so the repo is not relying on long-lived local state.

Most shared CLI commands now also write lifecycle events and run summaries into the active log directory. By default that is `./logs`, or the profile/runtime override in `NOTION_LOG_DIR`.

Run summaries now use four high-level statuses:

- `completed`: clean run with no material warnings
- `warning`: finished, but something needs attention
- `partial`: some useful work finished, but part of the run needs follow-up
- `failed`: the run did not complete cleanly

To inspect recent runs without opening JSONL files manually:

```bash
notion-os logs recent
notion-os logs recent --json
```

If you want the optional local pre-commit hook:

```bash
npm run hooks:install
```

That hook stays intentionally light. It blocks obvious machine-local artifacts and runs `npm run typecheck`. CI and `npm run verify` remain the real full gate.

## First Run

For a fresh machine:

1. Install dependencies with `npm ci`
2. Copy `.env.example` to `.env`
3. Fill in `NOTION_TOKEN`
4. Confirm the active profile points at the right config files
5. Run `npm run doctor`
6. Run `npm run verify`
7. Start with a dry-run publish before any live write

## Profiles

Phase 3 adds full workspace profiles so the same repo can point at different Notion environments safely.

- `config/profiles.json` stores the registry
- `config/profiles/<name>.json` stores each profile descriptor
- the active profile resolves the env file, destinations file, control-tower file, and the rest of the advanced JSON config set

Useful commands:

```bash
notion-os profiles list
notion-os profiles show
notion-os profiles migrate --write
notion-os profiles diff --against-profile default
notion-os profiles clone --source default --target sandbox --write
notion-os profiles bootstrap --target sandbox --write
notion-os profiles upgrade --write
notion-os --profile default doctor
```

## Sandbox Profile Discipline

Use a `sandbox` profile as the default proving ground before live changes that touch:

- `control-tower`
- `signals`
- `governance`
- `rollout`
- profile import, export, clone, bootstrap, or upgrade flows

Recommended setup:

```bash
cp .env .env.sandbox
notion-os --profile sandbox doctor
```

The repo now ships a tracked `sandbox` profile descriptor and its profile-owned JSON config files. The only local piece you normally need to supply is `.env.sandbox`, which should stay untracked.

Treat dry-run first as the rule in that profile unless you are explicitly rehearsing a live path.

If your shell exports overrides like `NOTION_DESTINATIONS_PATH`, those environment variables win over the profile descriptor. Unset them when you want the sandbox profile to resolve only its own profile-owned paths.

If you want a fuller walkthrough, see [docs/first-run.md](docs/first-run.md).

## Project Docs

- First-run onboarding: [docs/first-run.md](docs/first-run.md)
- Architecture overview: [docs/architecture-overview.md](docs/architecture-overview.md)
- Release process: [docs/release-process.md](docs/release-process.md)
- Post-Phase-4 repo roadmap: [docs/repo-post-phase4-roadmap.md](docs/repo-post-phase4-roadmap.md)
- Script surface classification: [docs/script-surface-classification.md](docs/script-surface-classification.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- GitHub portability notes: [docs/github-portability.md](docs/github-portability.md)
