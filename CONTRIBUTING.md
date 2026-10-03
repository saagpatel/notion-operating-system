# Contributing

## Local setup

Run development commands from the repository root with Node 24 and npm, matching
CI and release preparation. The library declares Node
`>=20`, but the locked Vitest 5 test runner requires `^22.12.0 || ^24.0.0 || >=26.0.0`;
Node 20 is not a supported development/test runtime.

Install the locked dependencies with `npm ci`. Its `prepare` hook runs the local
TypeScript build; it does not install Git hooks. Registry access is needed for
dependency installation. Local fixture tests do not require `.env`, Notion
tokens, installed BridgeDB/runtime services, or an operator profile. Use a
separate checkout without operator secrets for verification.

For explicitly requested operator setup, copy `.env.example` to `.env`, add only
the credentials you need, confirm the active profile's targets, then run
`npm run doctor`. With a token, doctor queries Notion access and destinations;
without one, its missing-token failure is expected, not a failed unit test.

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

For a focused local check, select the test file for the behavior changed. For
example, these config/doctor tests use temporary files and injected clients:

```bash
npm test -- tests/runtime-config.test.ts tests/doctor.test.ts
```

For runtime-generation changes, use `npm test -- tests/notion-runtime-generation-script.test.ts`.
Those tests create their own temporary Git/npm/runtime fixtures and copy npm's
package with contained helper links; they do not activate the installed runtime.
They require a POSIX filesystem, `/usr/bin/git`, and npm launched through `npm test`.

The broader local source checks are:

```bash
npm run typecheck
npm test
npm run build
```

The build writes `dist/`. There is no separate source lint/format npm script;
GitHub Actions runs workflow lint with actionlint. The existing assertions and
fixture timeouts apply unchanged.

Before shipping code changes, run the full gate in a clean checkout without
operator credentials:

```bash
npm run verify
```

This runs typecheck, all tests, build, and built/packed/Git-install CLI smoke
checks. Install smokes create temporary consumers, install dependencies from the
registry, and check exports/help; the Git install uses the local committed HEAD.
Use a checkout path without spaces or URL-escaped characters: the current built
CLI smoke resolves its root via a URL pathname. No Notion configuration or live
publish is required. `npm run verify:fresh-clone` copies the workspace into a
temporary clone, installs dependencies, runs the full gate, and checks the
expected no-token doctor failure. CI runs both lanes on Ubuntu with Node 24.

If you are touching package metadata, install posture, or release automation, also run:

```bash
npm run release:prepare
```

This adds local tarball/manifest generation under `tmp/release/`; it does not
publish a release. See [the release process](docs/release-process.md) for the
separately authorized manual GitHub workflow.

For changed CLI behavior, add or update the corresponding CLI tests. For changed
generated reports or Notion presentation, inspect fixture output first; a
signed-in browser readback of an authorized sandbox page is a conditional
provider check, separate from local test success.

For explicitly authorized risky advanced workflow rehearsal, use the sandbox
profile. This is a provider integration lane, not an offline fixture check.

The repo already includes the tracked `sandbox` profile config. In most cases you only need a local `.env.sandbox`, which should remain untracked.

Treat `notion-os --profile sandbox doctor` as the first provider access/isolation
gate and `npm run sandbox:smoke` as the fuller operational rehearsal. The smoke
copies `.env` and `.env.sandbox` into a temporary workspace and includes real
Notion writes (`--live`) plus GitHub signal reads. A temporary copy protects
repo-tracked files, not external targets. Only run it with explicit authority
for those sandbox effects; do not substitute maintenance, publish, runtime
activation, or live commands for local verification.

Before any live sandbox write, confirm the sandbox integration token and Notion targets are still isolated from the primary profile. The doctor now fails on token overlap, target overlap, and path masking.

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
