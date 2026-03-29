# First Run

This guide is the fast path for getting `Notion Operating System` working safely on a new machine.

## 1. Install

```bash
npm ci
```

You need Node.js 20 or newer.

## 2. Pick or confirm the active profile

Phase 3 adds workspace profiles.

- `config/profiles.json` lists the available profiles
- `config/profiles/<name>.json` defines the env file, destinations file, and control-tower file for that profile
- if the repo has not been migrated yet, the CLI still synthesizes an implicit `default` profile around the legacy layout

Helpful commands:

```bash
notion-os profiles list
notion-os profiles show
```

If you want to materialize the legacy layout into explicit profile files:

```bash
notion-os profiles migrate --write
```

If you want to prepare an additional profile safely:

```bash
notion-os profiles clone --source default --target sandbox
notion-os profiles bootstrap --target sandbox
```

## 3. Create local env

Copy `.env.example` to `.env`, then fill in the values you actually have.

Required:

- `NOTION_TOKEN`

Common optional credentials:

- `GITHUB_TOKEN`
- provider tokens used by external signal sync
- any other advanced credentials listed in `.env.example`

If you use a named profile, create that profile's env file instead of `.env` or set `NOTION_PROFILE` when you want to switch.

## 4. Check destination config

Make sure the active profile points at a destinations file with the aliases you expect.

Helpful command:

```bash
npm run destinations:check
```

## 5. Run doctor

Use the doctor command before any live write:

```bash
npm run doctor
```

This checks:

- Node version
- runtime config
- `.env` presence
- active profile selection and resolved profile paths
- destination config presence and schema validity
- Notion token presence
- Notion token access where possible
- destination reachability where possible

If you want machine-readable output:

```bash
npm run doctor -- --json
```

## 6. Run the full verify gate

Before you trust a fresh setup for regular work, run:

```bash
npm run verify
```

That covers typecheck, tests, and the built package path.

## 7. First dry-run publish

Start with a dry run instead of a live write:

```bash
npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly.md --dry-run
```

Or use a request file:

```bash
npm run publish:notion -- --request ./examples/requests/weekly_review.dry-run.json
```

## 8. First live publish

Only switch to live after the dry run looks correct:

```bash
npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly.md --live
```

## 9. Explore the CLI

The installable CLI name is `notion-os`, and the in-repo `tsx src/cli.ts ...` entrypoint still works too.

```bash
notion-os --help
notion-os --profile default doctor
notion-os control-tower --help
notion-os execution --help
notion-os intelligence --help
notion-os signals --help
notion-os governance --help
notion-os rollout --help
```

## 10. Optional local pre-commit hook

If you want a fast local guardrail before commits:

```bash
npm run hooks:install
```

The hook is intentionally light. It rejects staged machine-local artifacts like `.env`, `logs/`, `tmp/`, `dist/`, and `node_modules/`, then runs `npm run typecheck`.

## 11. Logs and run summaries

Shared CLI commands now write lifecycle events and run summaries to the active log directory.

- default log location: `./logs`
- override with `NOTION_LOG_DIR`
- use the active profile to confirm the resolved log path: `notion-os profiles show`

## Safety defaults

- Dry-run first unless you intentionally want a live write
- Prefer destination aliases over raw Notion IDs
- Use the right workspace profile before any write
- Use `doctor` on a fresh machine before writing
- Treat portfolio-wide sync commands as explicit operator actions, not automatic follow-ups
