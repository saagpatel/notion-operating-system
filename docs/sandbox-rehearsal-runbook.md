# Sandbox Rehearsal Runbook

Use the `sandbox` profile as the default operational proving lane before live changes that touch:

- `control-tower`
- `signals`
- `governance`
- `rollout`
- profile clone, bootstrap, import, export, or upgrade flows

The sandbox is now intended to be a real isolated Notion workspace, not just a same-shape copy of `default`.

## Minimum Sandbox Dataset

Keep a small but realistic rehearsal set available in the sandbox workspace:

- at least 2 Local Portfolio projects in different operational states
- at least 1 rollout candidate with a mapped GitHub source
- at least 1 non-candidate project that should stay Notion-only
- at least 1 execution chain with a linked decision, packet, and task
- at least 1 governance request set with both:
  - a request that is eligible for dry-run or live-safe rehearsal
  - a request that should stay blocked or skipped
- at least 1 external-signal provider path that succeeds
- at least 1 intentionally unsupported or missing-credential provider path for mixed-result rehearsal

This dataset manifest is conceptual on purpose. Titles and live IDs can change, but the sandbox should always preserve those record shapes so the smoke path stays meaningful.

## Before Live Write

Run these checks before any live rehearsal:

1. confirm `.env.sandbox` points at the sandbox integration token
2. unset shell overrides like `NOTION_DESTINATIONS_PATH` if you want the profile-owned sandbox paths to win
3. run `notion-os --profile sandbox doctor --json`
4. confirm the sandbox isolation checks pass:
   - `sandbox-path-overrides`
   - `sandbox-token-isolation`
   - `sandbox-target-isolation`

If any of those fail, stop and fix the sandbox config first.

## Smoke Sequence

Use the local smoke lane:

```bash
npm run sandbox:smoke
```

What it does:

- creates a temporary workspace copy so repo-tracked files do not get mutated
- runs `doctor --json` against `--profile sandbox`
- runs a control-tower dry-run
- validates the main saved-view plans
- runs the current live-safe rehearsal syncs for execution, intelligence, signals, and governance
- reads `logs recent --json` and confirms the smoke run was recorded

The smoke path is intentionally local and opt-in. It should not be added to CI unless the repo later gains a safe sandbox-secret automation path.

## After Sandbox Rehearsal

After a successful smoke or live-safe rehearsal:

1. inspect `notion-os --profile sandbox logs recent --json`
2. confirm the expected commands show `completed`, `warning`, or `partial` for understandable reasons
3. if a command is `partial` or `failed`, fix the underlying issue before using the same flow against the primary profile
4. keep the sandbox dataset healthy so the next rehearsal does not require ad hoc prep

## Proving Path Rule

Use the proving path that matches the risk:

- unit and integration tests: code confidence
- `npm run verify`: repo confidence
- `npm run verify:fresh-clone`: fresh-machine confidence
- `notion-os --profile sandbox doctor` plus `npm run sandbox:smoke`: operational confidence
