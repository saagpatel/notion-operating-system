# GitHub Portability Guide

This guide explains how to store this project in GitHub and recreate it on a different machine later.

Phase 10 also makes the repo installable from GitHub and GitHub release tarballs, while keeping npm publishing out of scope.

## Recommended Identity

- Project name: `Notion Operating System`
- Suggested GitHub repository name: `notion-operating-system`

That name fits what this repo is now: a local rules, automation, and publishing layer for a Notion-based project operating system.

## What To Commit

Commit the parts that define how the system works:

- `src/`
- `config/`
- `docs/`
- `examples/`
- `tests/`
- `package.json`
- `package-lock.json`
- `scripts/`
- `.githooks/`
- `tsconfig.json`
- `.env.example`
- `README.md`
- `AGENTS.md`
- `DESTINATIONS.md`
- `HANDOFF.md`
- `CLAUDE.md`

These files are the durable memory of the system: code, rules, config, examples, and operating guidance.

## What Not To Commit

Do not commit machine-local or secret state:

- `.env`
- `node_modules/`
- `logs/` run artifacts
- `.tmp/`
- `tmp/`
- `var/`

Most importantly, never commit real Notion or GitHub tokens.

## What A Fresh Machine Needs

A new machine should only need:

1. The GitHub repo contents.
2. Node.js 20 or newer.
3. A new local `.env` file built from `.env.example`.
4. A valid `NOTION_TOKEN`.
5. Notion integration access to the target pages and data sources.
6. Any optional provider credentials needed for advanced workflows.

## Fresh-Machine Bootstrap

After cloning the repo on a new machine:

```bash
npm install
cp .env.example .env
```

Then fill in the local `.env` values.

At minimum:

```bash
NOTION_TOKEN=...
NOTION_LOG_DIR=./logs
NOTION_DESTINATIONS_PATH=./config/destinations.json
NOTION_RETRY_MAX_ATTEMPTS=5
NOTION_HTTP_TIMEOUT_MS=90000
```

Next, confirm the basic setup:

```bash
npm run doctor
npm run destinations:check
npm run verify
```

If destination IDs ever need refreshing for that workspace, run:

```bash
npm run destinations:resolve
```

Then test a safe publish:

```bash
npm run publish:notion -- --request examples/requests/weekly_review.dry-run.json --dry-run
```

Only after that should you run a live write.

## Portability Expectations

This repo is portable, but the full system depends on external access that GitHub alone does not store:

- Notion integration token
- integration sharing permissions inside Notion
- live Notion pages and data sources
- any future GitHub or provider credentials used by advanced workflows

GitHub preserves the logic and configuration. Your local `.env` and external service access restore the live connection.

## GitHub Install Posture

The outside-facing package story is intentionally narrow in this phase:

- the root package is the reusable publishing toolkit
- `./advanced` remains available, but it is secondary and repo-specific
- releases are created manually through GitHub, not through npm publish automation

Core toolkit install example:

```bash
npm install github:saagpatel/notion-operating-system#v0.2.0
```

That git-ref install relies on the package building its distributable files during `prepare`.

If you want a verified packaged artifact instead of a git ref, use the tarball attached to a GitHub Release draft or release.

For release preparation details, see `docs/release-process.md`.

## Consumer install modes

Pick the install mode that matches your need:

1. GitHub ref install
   - best when you want the package directly from a tagged GitHub ref
2. GitHub release tarball install
   - best when you want the most controlled verified artifact
3. local repo development
   - best when you are working on the repo and want the full source-first workflow

## Practical Setup Strategy

For long-term safety, treat the system as three layers:

1. GitHub repo: code, config, docs, tests, examples
2. Local machine: `.env`, logs, scratch state, git hook config
3. External services: Notion workspace access and any other provider credentials

## Sandbox profile recommendation

For risky operational changes, create and use a `sandbox` profile before production writes:

```bash
notion-os profiles clone --source default --target sandbox --write
notion-os profiles bootstrap --target sandbox --write
notion-os --profile sandbox doctor
```

That profile is the recommended rehearsal path for control-tower, signals, governance, rollout, and profile-lifecycle changes.

That split makes the system easy to recover without leaking secrets into version control.
