# Architecture Overview

`Notion Operating System` now has four main layers plus a clearer package boundary between the reusable publishing toolkit and the advanced operating-system workflows.

## 1. CLI

The main CLI lives in `src/cli.ts` and `src/cli/`.

Phase 2 and Phase 3 introduce:

- a central command registry
- shared help output
- shared flag parsing
- global workspace profile selection
- compatibility wrappers for older script entrypoints
- an installable local bin: `notion-os`
- shared command-run lifecycle logging and summaries

This lets the main workflows share one operator-facing surface while keeping existing npm scripts usable through modern aliases and legacy compatibility names.

## 2. Runtime and config

Runtime config is centralized in `src/config/runtime-config.ts`.
Workspace profiles live in `src/config/profiles.ts`.

This layer is responsible for:

- resolving the active workspace profile
- loading environment values
- validating runtime settings
- resolving paths like the env file, destinations config, control-tower config, saved-view plans, and logs
- exposing safe shared defaults for retry, timeout, and logging behavior

Phase 4 also standardizes run-level observability here:

- `command_started`
- `command_completed`
- `command_failed`
- shared summary fields for dry-run/live mode, changed rows/pages, created or updated records, warnings, failures, retries, and timeouts

## 3. Notion publishing and API access

Core publishing and Notion API access live in modules such as:

- `src/publishing/`
- `src/notion/http.ts`
- `src/notion/direct-notion-client.ts`

This layer handles:

- destination resolution
- schema-aware writes
- markdown publishing
- Notion REST access
- dry-run-first behavior

## 4. Operating-system workflows

The broader Notion operating system lives mostly under `src/notion/`.

These workflow families include:

- control-tower sync and weekly review generation
- execution planning and packet management
- intelligence and recommendation workflows
- external signal syncing
- governance and actuation flows
- rollout workflows

Most of these commands are config-driven and are meant to keep the Notion system in sync with local evidence and operator intent.

## Package boundary

Phase 3 separates the public package surface into:

- core exports from `src/index.ts`
- advanced exports from `src/advanced.ts`

Root exports cover the reusable publishing toolkit:

- runtime config and profile loading
- destination registry loading
- doctor checks
- logging
- direct Notion access
- publishing

Advanced exports cover the repo-specific operating-system layers:

- control tower
- execution
- intelligence
- external signals
- governance and actuation
- native overlays and rollout support

Boundary rule:

- if a module is useful as a general Notion publishing or setup primitive, it belongs in the root package surface
- if it depends on this repo's specific control-tower, governance, execution, intelligence, signals, or rollout model, it belongs behind `./advanced`
- one-off historical utilities stay internal and should not be promoted into either public export surface unless a later phase makes that decision explicitly

## Compatibility strategy

The migration remains compatibility-first:

- the new CLI is the canonical interface
- existing npm script names remain usable
- covered legacy script files now act as thin wrappers into the shared CLI
- the legacy single-workspace layout still works through an implicit default profile

That keeps operator habits stable while reducing command sprawl internally.

## Verification and hygiene

Phase 4 adds a clearer release posture around the existing code:

- `npm run verify` is the canonical full local gate
- CI now covers typecheck, tests, build, and a built-CLI smoke run
- optional git hooks live under `.githooks/`
- `npm run hooks:install` enables the light local pre-commit check
