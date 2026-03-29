# Notion Operating System

Notion Operating System is a local automation layer for turning Notion into a real project and portfolio control system.

It started as a safe Markdown-to-Notion publisher, then grew into a broader system for publishing notes, maintaining project state, generating reviews, syncing external signals, and running governed workflows around Notion.

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

- a safe local publisher for Notion
- a code-backed operating system for running projects in Notion

## CLI

The canonical entrypoints are:

```bash
notion-os <command> [subcommand] [options]
tsx src/cli.ts <command> [subcommand] [options]
```

The older `npm run ...` scripts still work, but the shared CLI now keeps help text, flag parsing, runtime setup, and profile selection consistent across the main workflows.

You can explore the CLI with:

```bash
notion-os --help
notion-os --profile default doctor --help
tsx src/cli.ts --help
tsx src/cli.ts control-tower --help
npm run doctor -- --help
```

## Most Common Commands

```bash
# Run the full local release gate
npm run verify

# Verify local setup on a new machine
npm run doctor

# Show the active workspace profile and resolved paths
notion-os profiles show

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

## Verification And Logs

Use the full local gate before shipping changes:

```bash
npm run verify
```

This runs:

- `npm run typecheck`
- `npm test`
- `npm run build`

Most shared CLI commands now also write lifecycle events and run summaries into the active log directory. By default that is `./logs`, or the profile/runtime override in `NOTION_LOG_DIR`.

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
notion-os --profile default doctor
```

If you want a fuller walkthrough, see [docs/first-run.md](docs/first-run.md).

## Project Docs

- First-run onboarding: [docs/first-run.md](docs/first-run.md)
- Architecture overview: [docs/architecture-overview.md](docs/architecture-overview.md)
- Post-Phase-4 repo roadmap: [docs/repo-post-phase4-roadmap.md](docs/repo-post-phase4-roadmap.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- GitHub portability notes: [docs/github-portability.md](docs/github-portability.md)
