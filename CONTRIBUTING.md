# Contributing

## Local setup

1. Install dependencies with `npm ci`
2. Copy `.env.example` to `.env`
3. Add the credentials you actually need
4. Confirm the active profile points at the right config files
5. Run `npm run doctor`

## Main development commands

```bash
npm run typecheck
npm test
npm run build
npm run verify
npm run smoke:packed-install
npm run release:prepare
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
