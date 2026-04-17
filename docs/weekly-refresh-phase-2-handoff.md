# Weekly Refresh Orchestrator: Phase 2 Handoff

This file is the full handoff context for the next chat window.

Use it as the single source of truth for:

- what has already been built
- what is already complete
- what the current rollout posture is
- what is still left
- what the next phase should focus on

---

## 1. Current Snapshot

- Repo: `notion-operating-system`
- Working directory: `/Users/d/Notion`
- Current branch: `codex/weekly-refresh-orchestrator`
- Latest local commit: `c350420 feat(notion): add weekly refresh orchestrator`
- Working tree status at handoff: clean
- Date of this handoff: `2026-04-07`

This means the current phase work is already committed locally and there are no uncommitted repo changes at the moment.

---

## 2. Big Picture: What This Project Already Achieved Before This Phase

Before the weekly refresh orchestrator phase, the Notion operating system had already gone through a major cleanup and alignment effort.

That prior work included:

### GitHub and Notion alignment

- Audited GitHub repos against Notion project databases.
- Added missing GitHub repos into Notion.
- Filled missing source rows and source mappings.
- Re-ran audits until the GitHub vs Notion gap was closed.

### Notion hygiene and cleanup

- Removed duplicate Local Portfolio project rows.
- Cleaned support-database duplicates across skills, research, and tools.
- Filled empty fields across local portfolio project records.
- Archived stale low-risk orphan support rows.
- Classified weak support rows into:
  - actionable
  - intentionally single-project

### Support-layer enrichment

- Audited GitHub repos and used repo evidence to update:
  - skills
  - research / knowledge
  - AI tools
- Backfilled project support coverage for many active-build projects.
- Added support maintenance automation and supporting audits.

### Existing automation posture before this phase

The support layer already had a narrow safe automation lane:

- `weekly-github-notion-maintenance`

That automation was intentionally narrower than a full portfolio refresh. It handled the support lane, not the broader Command Center / control-tower refresh lane.

This distinction is why the Local Portfolio Command Center could still appear stale even when support databases were fresher.

---

## 3. Why This Phase Existed

The purpose of this phase was to close the biggest remaining operating gap:

### Problem

The Notion system had:

- a strong support-maintenance lane
- a separate broader control-tower / Command Center refresh lane
- manual prompting still required for broad weekly refreshes

That meant the system was useful, but not yet fully self-maintaining.

### Risk discovered in the audit

The main technical risk was **page overwrite sequencing**.

Specifically:

- `control-tower-sync` republishes the full Command Center page.
- `execution-sync`, `intelligence-sync`, and `external-signal-sync` patch managed sections into that page.
- `review-packet` rebuilds the weekly review.
- `external-signal-sync` also patches a managed external-signals section into the weekly review.

Without marker preservation, a later broad republish could wipe out richer downstream sections.

### Decision for this phase

The chosen direction was:

- **Codex-local remains the canonical scheduler for now**
- **GitHub-ready design, but not GitHub Actions as the live scheduler yet**
- **shadow first, cut over later**
- **safe weekly operating lane only**

This phase did **not** include:

- overhaul commands
- governance actuation
- rollout commands
- dual schedulers
- native Notion automation as the canonical state engine

---

## 4. What Was Implemented In This Phase

### 4.1 New weekly orchestrator

Added a new durable command:

```bash
npm run maintenance:weekly-refresh
```

Legacy compatibility alias:

```bash
npm run portfolio-audit:weekly-refresh
```

Main implementation file:

- `src/notion/weekly-refresh.ts`

This orchestrator:

- runs dry-run by default
- performs an internal preflight before live mode
- only executes live writes when preflight shows real drift
- produces one consolidated JSON output
- handles dependency-aware skips
- tracks status per step
- has retry handling for transient network failures
- has per-step timeouts so the run fails cleanly instead of hanging forever

### 4.2 Shared weekly-step contract

Added:

- `src/notion/weekly-refresh-contract.ts`

This standardizes the weekly-lane steps around:

- `status`
- `wouldChange`
- `summaryCounts`
- `warnings`
- `skippedReason`

This contract was applied to:

- GitHub support maintenance
- control-tower sync
- execution sync
- intelligence sync
- review packet
- external-signal sync

### 4.3 Managed-section preservation

Added:

- `src/notion/managed-markdown-sections.ts`

Extended the markdown utilities and renderers so the Command Center and weekly review preserve managed sections during republish.

Important files updated:

- `src/utils/markdown.ts`
- `src/notion/local-portfolio-control-tower.ts`
- `src/notion/local-portfolio-execution.ts`
- `src/notion/control-tower-sync.ts`
- `src/notion/review-packet.ts`

This is the fix for the earlier page-overwrite risk.

### 4.4 Freshness by layer

Added weekly maintenance state to:

- `config/local-portfolio-control-tower.json`

Extended Command Center rendering so it now has a `Freshness By Layer` section covering:

- support maintenance
- control tower
- execution
- intelligence
- external signals
- weekly review
- last weekly refresh result

### 4.5 CLI and npm wiring

Updated:

- `src/cli/registry.ts`
- `package.json`

So the weekly orchestrator is available both as:

- the durable CLI surface
- a compatibility alias for older repo workflows

### 4.6 Docs and review artifacts

Added:

- `docs/weekly-refresh-maintenance.md`
- `docs/weekly-refresh-implementation-review.md`

Updated:

- `docs/maintenance-playbook.md`
- `docs/github-support-maintenance.md`

These docs explain:

- the weekly lane
- rollout posture
- what is intentionally deferred
- rollback posture

---

## 5. Important Files Added Or Changed In This Phase

### New files

- `src/notion/managed-markdown-sections.ts`
- `src/notion/weekly-refresh-contract.ts`
- `src/notion/weekly-refresh.ts`
- `docs/weekly-refresh-maintenance.md`
- `docs/weekly-refresh-implementation-review.md`
- `docs/weekly-refresh-phase-2-handoff.md` (this handoff file)

### Core files changed

- `src/notion/control-tower-sync.ts`
- `src/notion/execution-sync.ts`
- `src/notion/intelligence-sync.ts`
- `src/notion/external-signal-sync.ts`
- `src/notion/review-packet.ts`
- `src/internal/notion-maintenance/github-support-maintenance.ts`
- `src/notion/local-portfolio-control-tower.ts`
- `src/notion/local-portfolio-execution.ts`
- `src/utils/markdown.ts`
- `src/cli/registry.ts`
- `package.json`
- `config/local-portfolio-control-tower.json`

### Tests changed

- `tests/cli.test.ts`
- `tests/control-tower.test.ts`
- `tests/package-surface.test.ts`

---

## 6. Verification Already Performed

### Static verification

Passed:

- `npm run typecheck`
- `npx vitest run tests/control-tower.test.ts tests/cli.test.ts tests/package-surface.test.ts`

### Weekly orchestrator dry-run verification

`npm run maintenance:weekly-refresh` now runs end to end and produces a consolidated preflight summary.

### Dry-run behavior on 2026-04-06

The orchestrator completed preflight successfully and reported:

- support maintenance clean
- control tower drift
- execution drift
- intelligence drift
- review packet drift
- external signals drift

At that point the signals dry run was still too heavy and looked more like live polling than a lean preflight.

### Live pilot on 2026-04-06

A manual live pilot was started.

Observed outcome:

- control-tower state advanced
- the run made it into the live external-signals step
- that step became the pacing item
- the live pilot was interrupted instead of being allowed to run indefinitely

This means:

- the orchestrator is real enough to exercise the live path
- but the rollout was **not** promoted to cutover

### Optimization pass on 2026-04-07

The external-signals dry run was tightened so it no longer performs the same heavy provider work during dry mode.

This improved dry-run behavior substantially:

- the external-signals dry run now scopes to a bounded source/project slice
- it reports `targetProjectCount`
- it uses existing Notion signal state for preflight instead of full provider fetch work in dry mode

### Dry-run benchmark on 2026-04-07

One timed weekly dry run hit transient network failures:

- GitHub Support Maintenance: failed after retries with `fetch failed`
- Execution Sync: failed after retries with `fetch failed`
- Intelligence Sync: failed after retries with `fetch failed`
- Control Tower / Review Packet / External Signals still completed

That run took about:

- `5:19` total wall time

Important interpretation:

- this result is **not** mainly about code correctness
- it is mainly about transient network/API reliability during preflight
- the orchestrator did the correct thing by:
  - retrying transient errors
  - surfacing failure status
  - not pretending the run succeeded

So the current remaining issue is operational reliability, not missing architecture.

---

## 7. Current Automation State

### Existing older live automation still active

Support-only live lane:

- automation id: `weekly-github-notion-maintenance`
- name: `Weekly GitHub Notion Maintenance`
- status: `ACTIVE`

This older automation should remain active until the weekly-refresh lane is proven and cut over.

### New shadow automation

The user created the new shadow automation already.

Automation file:

- `/Users/d/.codex/automations/weekly-refresh-shadow/automation.toml`

Current contents show:

- id: `weekly-refresh-shadow`
- name: `Weekly Refresh Shadow`
- status: `ACTIVE`
- weekly Monday run
- dry-run only

Its purpose is to:

- run `npm run maintenance:weekly-refresh`
- create one inbox item
- summarize:
  - Freshness
  - Expected Changes
  - Follow-Up
- avoid live writes

### Report-only automation that should remain unchanged

- `weekly-command-center`

This is still report-only and should remain unchanged.

---

## 8. Current Rollout Posture

The correct rollout posture at handoff is:

### Completed

- implementation
- contract layer
- docs
- local commit
- shadow automation creation

### Not yet completed

- shadow validation over 1 to 2 cycles
- final live pilot after shadow observations
- live cutover
- pausing the old support-only live automation

### Explicitly not done yet

- no cutover to live weekly-refresh automation
- no pause of `weekly-github-notion-maintenance`
- no GitHub Actions scheduler

---

## 9. Current Known Risks / Open Issues

### 9.1 Transient network reliability

On April 7, 2026, a timed weekly dry run saw repeated transient `fetch failed` errors on multiple steps.

This suggests:

- Notion/API connectivity can still be noisy enough to affect shadow runs
- retries and failure reporting are necessary
- rollout should use evidence from shadow runs before cutover

### 9.2 External-signals live step is still the heaviest live step

Even after improving dry mode, the live GitHub external-signals step remains the slowest part of the weekly lane.

This does **not** block the architecture.

It does mean:

- cutover should be based on shadow evidence and a controlled live pilot
- further live-step tuning may still be useful

### 9.3 Partial state from earlier live pilot

The earlier live pilot on April 6 advanced some real Notion state, especially in control-tower areas.

This means the next chat should treat the current state as:

- partly refreshed by real runs
- not fully cut over
- needing a fresh audit before any final cutover decision

---

## 10. What The Next Phase Should Entail

This next phase should be treated as:

## Phase 2: Weekly Refresh Rollout And Cutover

The focus is **not** more architecture.

The focus is:

### 10.1 Shadow validation

Let the `weekly-refresh-shadow` automation run for 1 to 2 cycles.

For each run, evaluate:

- which steps are clean
- which steps still drift
- whether transient failures continue
- whether external-signals dry run remains reasonably bounded
- whether the output is useful and readable

### 10.2 Analyze the shadow results

Decide:

- are failures mostly transient noise?
- are any steps consistently failing?
- is the weekly dry-run runtime acceptable?
- is the drift surface understandable?

### 10.3 Run one more manual live pilot

Only after reviewing shadow results:

- rerun `npm run maintenance:weekly-refresh -- --live`
- watch whether the live lane settles more cleanly than the first pilot
- especially observe:
  - external-signals live step duration
  - final freshness state
  - whether the second live run becomes close to no-op

### 10.4 Decide on cutover

If the shadow runs and live pilot look healthy:

- create or update the live weekly-refresh automation
- pause the old `weekly-github-notion-maintenance` automation
- leave `weekly-command-center` unchanged

### 10.5 Post-cutover completion review

Once cutover is done:

- verify the old support-only live automation is paused
- verify the new live weekly-refresh lane is active
- verify the report-only weekly digest is still unchanged
- capture the final operating rhythm in docs

---

## 11. Recommended Immediate Next Tasks For The Next Chat

The next chat should likely do this in order:

1. Read this handoff file.
2. Inspect the current shadow automation and older support automation.
3. Review the current weekly-refresh code and docs.
4. Decide whether to stay in plan mode first or go straight into rollout review.
5. Check whether a shadow run has already happened.
6. If shadow evidence exists, analyze it.
7. If shadow evidence does not exist yet, prepare the rollout review workflow and waiting posture.

Then the next chat should aim to produce:

- a rollout review
- a cutover recommendation
- a concrete plan for the live automation promotion

---

## 12. Commands The Next Chat Will Probably Need

### Core commands

```bash
npm run maintenance:weekly-refresh
npm run maintenance:weekly-refresh -- --live
```

### Supporting commands

```bash
npm run portfolio-audit:github-support-maintenance
npm run portfolio-audit:control-tower-sync
npm run portfolio-audit:execution-sync
npm run portfolio-audit:intelligence-sync
npm run portfolio-audit:review-packet
npm run portfolio-audit:external-signal-sync -- --provider github
```

### Verification

```bash
npm run typecheck
npx vitest run tests/control-tower.test.ts tests/cli.test.ts tests/package-surface.test.ts
```

### Automation inspection

```bash
sed -n '1,220p' /Users/d/.codex/automations/weekly-refresh-shadow/automation.toml
sed -n '1,220p' /Users/d/.codex/automations/weekly-github-notion-maintenance/automation.toml
sed -n '1,220p' /Users/d/.codex/automations/weekly-command-center/automation.toml
```

---

## 13. Key Files The Next Chat Should Read First

### Core implementation

- `src/notion/weekly-refresh.ts`
- `src/notion/weekly-refresh-contract.ts`
- `src/notion/external-signal-sync.ts`
- `src/notion/local-portfolio-control-tower.ts`

### Docs

- `docs/weekly-refresh-maintenance.md`
- `docs/weekly-refresh-implementation-review.md`
- `docs/maintenance-playbook.md`
- `docs/github-support-maintenance.md`

### State

- `config/local-portfolio-control-tower.json`

---

## 14. Final State At Handoff

The most accurate summary is:

- the weekly refresh orchestrator is implemented
- the code is committed locally
- the repo is clean
- the new dry-run shadow automation exists and is active
- the old support-only live automation is still active
- cutover has **not** happened yet
- the next phase is **rollout validation and cutover decision**, not more core implementation

That is the exact seam where the next chat should pick up.
