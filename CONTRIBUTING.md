# Contributing

## Local setup

1. Install dependencies with `npm ci`
2. Copy `.env.example` to `.env`
3. Add the credentials you actually need
4. Confirm the active profile points at the right config files
5. Run `npm run doctor`

## Repo governance

- `main` is protected
- all work should land through pull requests
- required status checks are mandatory before merge
- required approval count is intentionally `0` for now because the repo currently has one primary maintainer
- merge commits remain the preferred merge strategy for this repo
- do not treat `npm run release:prepare` as a bypass around CI; it is an additional gate

## Main development commands

```bash
npm run typecheck
npm test
npm run build
npm run verify
npm run smoke:packed-install
npm run smoke:git-install
npm run release:prepare
npm run sandbox:smoke
npm run doctor
npm run hooks:install
notion-os --help
```

## CLI expectations

Phase 3 keeps the shared CLI as the canonical operator surface and adds workspace profiles plus the installable `notion-os` bin.

When adding or changing a covered command:

- prefer the shared CLI registry over one-off argument parsing
- keep help text clear
- preserve compatibility with existing npm script names
- keep `--profile <name>` working across the central CLI
- support `--config <path>` where the command already had positional config-path behavior

## Safety expectations

- dry-run first unless a live write is explicit
- do not hardcode secrets
- prefer destination aliases over raw Notion IDs
- preserve non-secret profile bundles and never export live `.env` secrets
- keep destructive behavior opt-in

## Tests

Before shipping changes, run:

```bash
npm run verify
```

If you are touching package metadata, install posture, or release automation, also run:

```bash
npm run release:prepare
```

If you are touching risky advanced workflows, also rehearse from the sandbox profile first.

The repo already includes the tracked `sandbox` profile config. In most cases you only need a local `.env.sandbox`, which should remain untracked.

Treat `notion-os --profile sandbox doctor` as the first proof gate and `npm run sandbox:smoke` as the fuller operational rehearsal. The smoke path runs from a temporary workspace copy so repo-tracked files do not get rewritten while you exercise the safe sandbox sequence.

Before any live sandbox write, confirm the sandbox integration token and Notion targets are still isolated from the primary profile. The doctor now fails on token overlap, target overlap, and path masking.

If you touch CLI behavior, add or update CLI tests.

If you touch Notion publishing behavior, preserve existing dry-run and schema-validation safety expectations.

## Logs and hooks

- shared CLI commands write lifecycle logs and run summaries to the active log directory
- default log location is `./logs` unless `NOTION_LOG_DIR` or the active profile changes it
- the optional pre-commit hook is installed with `npm run hooks:install`
- the hook is intentionally light: it blocks staged machine-local artifacts and runs `npm run typecheck`

## Release posture

- this repo is GitHub-installable in Phase 10, but still not published to npm
- the public-facing story is the core toolkit first; `./advanced` remains secondary and repo-specific
- manual release guidance lives in `docs/release-process.md`

## Dependency hygiene

- GitHub runs a scheduled dependency hygiene workflow weekly
- Dependabot is the default updater for npm and GitHub Actions dependencies
- npm overrides should be treated as temporary mitigations and revisited when upstream fixes land cleanly
- the recurring maintenance rhythm now lives in `docs/maintenance-playbook.md`
- the sandbox rehearsal expectations now live in `docs/sandbox-rehearsal-runbook.md`
