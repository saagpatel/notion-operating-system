# Batch Planning Packet: knowledgecore, IncidentWorkbench, KBFreshnessDetector, PersonalKBDrafter, ScreenshotAnnotate

Updated: 2026-03-21

## Scope

This packet covers only this batch:

- knowledgecore
- IncidentWorkbench
- KBFreshnessDetector
- PersonalKBDrafter
- ScreenshotAnnotate

Batch goal:

- fully reflected in Notion
- fully set up in GitHub and connected to the operating flow
- no longer orphaned in the Notion control tower
- clearly assessed for checks, blockers, and readiness so execution can move without re-discovery

## Evidence Basis

The packet is based on:

- the Notion repo configs and scripts in `/Users/d/Notion`
- the local project folders under `/Users/d/Projects`
- live Notion records read through the repo tooling
- current GitHub state checked during this session

Important timing note:

- Planning date is 2026-03-21 Pacific time.
- Some GitHub events are dated 2026-03-22 in UTC.

## Batch Summary

- All five projects already exist in `Local Portfolio Projects`.
- All five are still orphaned by the control-tower metric because each currently has `0` linked build sessions, research items, skills, and tools.
- `KBFreshnessDetector` and `PersonalKBDrafter` already have active GitHub operating-flow wiring in Notion.
- `knowledgecore`, `IncidentWorkbench`, and `ScreenshotAnnotate` do not.
- The local `origin` remotes for `knowledgecore`, `IncidentWorkbench`, and `ScreenshotAnnotate` point to `saagar210/...` repos that currently return `Repository not found`.
- Default execution assumption: use `saagpatel` as the canonical owner for any repo that must be recreated or re-homed in this batch, unless access to the original `saagar210` repos is restored before execution.

## Current State Per Project

### knowledgecore

Current state:

- Notion project exists and currently reads `Needs Decision / Build Now`.
- Notion already has a committed portfolio decision dated 2026-03-21 saying not to migrate it yet.
- There is no GitHub source row, no actuation target, no packet, no tasks, and no governance evidence linked to the project in Notion.
- Local repo exists at `/Users/d/Projects/knowledgecore`.
- Local repo has a dirty worktree.
- Local repo has several GitHub workflow files, but `.codex/verify.commands` is stale and references nonexistent root `npm` commands even though the repo has no root `package.json`.
- Local `origin` points to `https://github.com/saagar210/knowledgecore.git`, which currently returns `Repository not found`.

Exact gaps:

- readiness is not strong enough yet for GitHub onboarding
- GitHub destination is missing or inaccessible
- verify surface is stale and misleading
- Notion has no execution scaffolding for current work
- orphan status has not been cleared

Known blockers and dependencies:

- high setup friction in Notion
- `Runs Locally` is only `Partial`
- `Phase D-K acceptance tests not passing`
- desktop UI still needs wiring before resumption

Done definition:

- readiness blockers are reduced enough to justify migration
- reachable GitHub repo exists under the canonical owner
- verify commands reflect the Rust and Tauri workspace reality
- the current Notion decision is superseded by fresh evidence
- GitHub source, actuation target, packet, and tasks exist in Notion
- the project has linked evidence and is no longer orphaned

### IncidentWorkbench

Current state:

- Notion project exists and currently reads `Ready to Demo / Worth Finishing`.
- Notion already has a ready finish packet and ready tasks for Zendesk support, Statuspage integration, and finish proof.
- There is no GitHub source row, no actuation target, no action request, and no webhook evidence linked to the project in Notion.
- Local repo exists at `/Users/d/Projects/ITPRJsViaClaude/IncidentWorkbench`.
- Local repo has a dirty worktree, but the local delta is small compared with other batch projects.
- Local repo has a strong workflow surface and strict backend verification commands.
- Local `origin` points to `https://github.com/saagar210/IncidentWorkbench.git`, which currently returns `Repository not found`.

Exact gaps:

- GitHub destination is missing or inaccessible
- Notion execution work is not connected to a GitHub lane
- no external signal coverage exists for the project
- orphan status has not been cleared

Known blockers and dependencies:

- repo ownership or destination must be resolved first
- current packet and tasks should be preserved and linked forward, not recreated blindly

Done definition:

- reachable GitHub repo exists under the canonical owner
- Notion has a GitHub source row and actuation target for the project
- first external-signal sync populates repo and workflow evidence
- current finish packet and tasks are aligned to the GitHub lane
- the project has linked evidence and is no longer orphaned

### KBFreshnessDetector

Current state:

- Notion project exists and currently reads `Ready to Demo / Needs Review`.
- Notion already has an active GitHub source, in-progress rollout packet, ready tasks, executed action requests, and webhook evidence.
- Local repo exists at `/Users/d/Projects/ITPRJsViaClaude/KBFreshnessDetector`.
- Local repo is clean.
- Local repo already points to `saagpatel/KBFreshness` and preserves `legacy-origin`.
- GitHub is live and reachable.
- GitHub currently has 1 open Dependabot PR.
- GitHub has recent failed workflow runs on that PR.
- Local `.codex/verify.commands` is effectively empty for real verification.

Exact gaps:

- project metadata still leaves `Runs Locally` as `Unknown`
- blocker text is still generic
- verification contract is incomplete locally
- live lane exists, but it is not yet stable enough to call fully set
- orphan status has not been cleared

Known blockers and dependencies:

- recent failed workflows must be triaged
- the first real freshness workflow needs to be rerun and captured into Notion

Done definition:

- recent workflow failures are triaged to a known green or explicitly accepted state
- the first real freshness run and first blocker are captured in Notion
- `.codex/verify.commands` matches the repo’s actual gates
- project metadata reflects real operability and readiness
- the project has linked evidence and is no longer orphaned

### PersonalKBDrafter

Current state:

- Notion project exists and already has an active GitHub source, completed onboarding packet and tasks, executed action request, and webhook evidence.
- Notion still shows the project as `Parked / Needs Review`.
- Derived GitHub fields on the project are stale relative to live activity.
- Local repo exists at `/Users/d/Projects/ITPRJsViaClaude/PersonalKBDrafter`.
- Local repo has a heavily dirty worktree.
- Local repo already points to `saagpatel/PersonalKBDrafter` and preserves `legacy-origin`.
- GitHub is live and reachable.
- GitHub currently has 2 open Dependabot PRs.
- GitHub currently has a failed `CI` run on `main`.

Exact gaps:

- Notion project state and blocker text are stale and generic
- project-level GitHub fields do not reflect current PR and workflow reality
- large local changes are not yet translated into a clear execution slice
- GitHub lane is active, but confidence is still low
- orphan status has not been cleared

Known blockers and dependencies:

- local branch state needs reconciliation before the project can be called stable
- happy-path validation needs to be rerun and documented
- current GitHub failures and open PRs must be triaged

Done definition:

- Notion metadata matches live GitHub state
- local branch state is reconciled into a clear current execution slice
- happy-path validation is rerun and the first blocker or green proof is written down
- CI and dependency PR posture is triaged to a known state
- the project has linked evidence and is no longer orphaned

### ScreenshotAnnotate

Current state:

- Notion project exists and currently reads `Parked / Needs Review`.
- There is no GitHub source row, no packet, no tasks, no governance evidence, and no external signal coverage linked to the project in Notion.
- Local repo exists at `/Users/d/Projects/ITPRJsViaClaude/ScreenshotAnnotate`.
- Local repo has a heavily dirty worktree.
- Local repo has workflow files, but `.codex/verify.commands` only covers perf checks and is not a full readiness gate.
- Local `origin` points to `https://github.com/saagar210/ScreenshotAnnotate.git`, which currently returns `Repository not found`.

Exact gaps:

- GitHub destination is missing or inaccessible
- Notion has no GitHub lane scaffolding for the project
- verify surface is incomplete
- current local work is not reflected in operating records
- orphan status has not been cleared

Known blockers and dependencies:

- repo ownership or destination must be resolved first
- local dirty worktree should be turned into an explicit packet and task set rather than left implicit

Done definition:

- reachable GitHub repo exists under the canonical owner
- Notion has source, actuation, packet, and task scaffolding for the project
- verify commands reflect actual repo gates
- current local work is turned into a concrete execution slice
- the project has linked evidence and is no longer orphaned

## Recommended Order of Execution

1. Shared repo-destination pass for `knowledgecore`, `IncidentWorkbench`, and `ScreenshotAnnotate`
2. Finish `KBFreshnessDetector`
3. Finish `PersonalKBDrafter`
4. Onboard `IncidentWorkbench`
5. Onboard `ScreenshotAnnotate`
6. Reassess and then onboard `knowledgecore`

Why this order:

- `KBFreshnessDetector` is already deepest into the GitHub lane and is the fastest path to one fully passing project.
- `PersonalKBDrafter` is also already onboarded, but its metadata drift and local branch drift are higher.
- `IncidentWorkbench` is the cleanest missing-migration candidate once the repo destination exists.
- `ScreenshotAnnotate` needs both GitHub lane setup and stronger execution scaffolding.
- `knowledgecore` should stay last because it has the strongest readiness blockers and an explicit current Notion decision against migration.

## Shared Work That Should Be Done Once

- confirm the canonical GitHub owner and destination rule for the three missing or inaccessible repos
- use one shared GitHub-lane onboarding playbook for every missing or stale project:
  - confirm repo owner and name
  - add or repair the External Signal Source row
  - add or repair the actuation target row
  - run external-signal sync
  - run control-tower sync
  - seed one onboarding or validation packet
  - seed one governed GitHub issue request
- clear orphan status the same way for every project:
  - add at least one linked build session, research item, skill, or tool record
- normalize these project fields across the batch:
  - `Runs Locally`
  - `Setup Friction`
  - `Biggest Blocker`
  - `Next Move`
  - `Test Posture`
  - `Ship Readiness`
- repair stale `.codex/verify.commands` where needed so the operating flow has a trustworthy local check contract

## Batch-Level Blockers

- three local remotes currently point to missing or inaccessible GitHub repos
- all five projects are still orphaned by the control-tower metric
- two projects already in the GitHub lane still need stabilization before they can be called fully set
- `knowledgecore` should not be forced into GitHub onboarding until readiness improves enough to invalidate the current Notion decision

## Default Assumptions for Execution

- `Local Portfolio Projects` remains the portfolio source of truth
- current local worktrees and any `legacy-origin` remotes should be preserved
- if `saagar210` access is not restored at execution time, recreate or re-home the missing repos under `saagpatel`
- after each material GitHub onboarding or stabilization step, rerun:
  - external signal sync
  - control tower sync
- do not count a project as done until both GitHub wiring and orphan-status clearance are complete
