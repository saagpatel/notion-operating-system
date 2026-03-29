# GitHub Portability Guide

This guide explains how to store this project in GitHub and recreate it on a different machine later.

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

## Practical Setup Strategy

For long-term safety, treat the system as three layers:

1. GitHub repo: code, config, docs, tests, examples
2. Local machine: `.env`, logs, scratch state, git hook config
3. External services: Notion workspace access and any other provider credentials

That split makes the system easy to recover without leaking secrets into version control.
