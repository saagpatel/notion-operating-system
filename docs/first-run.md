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

The repo already includes a tracked `sandbox` profile descriptor and profile-owned JSON files. To make it usable on your machine, add a local env file for it:

```bash
cp .env .env.sandbox
notion-os --profile sandbox profiles show
notion-os --profile sandbox doctor
```

That gives you a same-shape rehearsal lane, not an automatically isolated live sandbox. Copying `.env` is fine only as a first bootstrap step for dry-run and config rehearsal. Before any live sandbox write you must repoint `.env.sandbox`, `config/profiles/sandbox/destinations.json`, and any other sandbox Notion target IDs to a separate sandbox workspace.

The sandbox doctor now enforces that rule. It fails when:

- the sandbox token matches the primary token
- sandbox Notion target refs overlap the primary profile
- an env override like `NOTION_DESTINATIONS_PATH` masks the sandbox-owned destinations file

If you need to recreate the sandbox profile files from scratch, you can still use:

```bash
notion-os profiles clone --source default --target sandbox --write
notion-os profiles bootstrap --target sandbox --write
```

The recommended extra profile is `sandbox`. Use it as the proving environment before live changes to governance, signals, rollout, control-tower, or profile-lifecycle flows.

## 3. Create local env

Copy `.env.example` to `.env`, then fill in the values you actually have.

Required:

- `NOTION_TOKEN`

Common optional credentials:

- `GITHUB_TOKEN`
- provider tokens used by external signal sync
- any other advanced credentials listed in `.env.example`

If you use a named profile, create that profile's env file instead of `.env` or set `NOTION_PROFILE` when you want to switch.

If your shell exports path overrides like `NOTION_DESTINATIONS_PATH`, remember that those environment variables win over the profile descriptor values. Unset them when you want a named profile to use only its own tracked config paths.

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

For risky operational workflow changes, also rehearse from the sandbox profile before using live production state.

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
