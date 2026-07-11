# Orchestrator + Maintenance Layer — Subagent Map

*Produced by map-orchestrator (Explore agent), 2026-07-10. File:line refs cited by the agent; spot-verify before acting on any single claim.*

## ARCHITECTURE — weekly orchestrator step graph & gating

Entry: `runWeeklyRefreshCommand` (`src/notion/weekly-refresh.ts:127`), surfaced as `maintenance weekly-refresh` (`src/cli/registry.ts:1689`).

**Six lanes, fixed order** (`WEEKLY_STEP_KEYS`, `weekly-refresh.ts:109-116`; step objects `:297-368`):
1. **support-maintenance** — script spawn, 10-min timeout (`:299-304`)
2. **control-tower-sync** — 10-min; `skipAfterControlTowerFailure:false` (`:305-312`)
3. **execution-sync** — 15-min; skip-after-CT:true (`:313-329`)
4. **intelligence-sync** — 15-min; skip-after-CT:true (`:330-346`)
5. **review-packet** — 10-min; skip-after-CT:true (`:347-354`)
6. **external-signals** — 20-min; skip-after-CT:true (`:355-367`)

**Two-phase preflight→live gate** (`:179-219`). A full dry-run preflight always runs first. Live runs ONLY if: `flags.live` AND `needsLiveWrite` (some preflight step reported `wouldChange`) AND preflight status neither `failed` nor `partial` (`:199`). Core safety property: a broken or no-op preflight never escalates to writes.

**`--confirm-full-live` gate** (`:164-172`): bare `--live` without it throws immediately, steering the operator to targeted single-lane repair.

**`--only`/`--skip` selector** (`applyStepFilters :748-766`). Mutually exclusive. Selecting lanes disables full-run state persistence: `shouldPersistWeeklyRefreshState` (`:1103-1108`) true only when `live && !only && !skip` — targeted repairs deliberately don't rewrite weekly freshness state (`:229-243`).

**Why ordering matters.** control-tower-sync (lane 2) ensures the command-center page + phase-state config exist. Lanes 3-6 patch managed sections into that page. Enforced structurally: in live phase `stopAfterControlTowerFailure:true` (`:202`); `runWeeklyRefreshSteps` (`:501-532`) latches `controlTowerFailed` (`:526-528`) and short-circuits downstream lanes into "Skipped because control-tower sync failed" (`:513-517`). Self-heal: on read-back-recoverable patch failure during a full run, `replaceCommandCenterPageAfterPatchFailure` (`:1218-1257`) recreates the page + repoints the destination registry; targeted refreshes leave the page in place (`:1178-1181`).

## MECHANISMS

**Step retry** (`runStep :534-590`): up to `maxStepAttempts` (default 5; 2 under `--fast`, `:147`), gated by `shouldRetryStepError` (`:569`) — only transient network errors retry. Backoff `min(30_000, attempts²×2_000)` ms (`:573`). Exhaustion → synthesized `status:"failed"` + `failureCategory` (`:576-589`).

**Step timeout**: per-step defaults (10-20 min); `--step-timeout-minutes` overrides ALL steps uniformly (`:375-380`). Each step spawns a `tsx` child (`runJsonCommand :616-664`); `setTimeout` sends SIGTERM on expiry (`:645-648`); child's last JSON object is the step contract (`:664`).

**Concurrency (`--project-concurrency`)** is NOT orchestrator parallelism — steps run strictly sequentially (`:512`). Flag forwards to `execution`/`intelligence` child CLIs (`:323-324,340-341`). External-signals live runs chunk into 20-project batches (`:123`, `expandExternalSignalLiveProjectBatches :427`), each forced to concurrency 1 (`:470`).

**Catch-up/staleness** (`buildWeeklyRefreshCatchUpStatus :843-896`): gapDays vs `staleDataThresholdDays` (default 2) sets `staleBeforeRun`; weekday/weekend catch-up mode. Telemetry only.

**Notion API retry/rate-limit** (`src/notion/http.ts`): `NOTION_RETRY_MAX_ATTEMPTS` default 5, `NOTION_HTTP_TIMEOUT_MS` default 90s. Timeout retries sleep `min(attempt×1000,5000)`; transport `min(attempt×1500,8000)`; **429 honors server `Retry-After`**; 4xx non-429 thrown immediately. Structured log events (`notion_http_retry`, `notion_http_timeout`, `notion_http_retry_exhausted`, `notion_http_failure`). The post-live freshness client runs `maxAttempts:1` + 20s timeout (`weekly-refresh.ts:1151-1153`) so a cosmetic patch can't hang the run; its transport errors are swallowed (`:1191-1195`).

**Maintenance passes** (`src/internal/notion-maintenance/`; all dry-run default, `--live` to mutate):
- **notion-hygiene-pass** (`main :123`): GitHub↔Notion alignment; archives duplicate rows (`in_trash:true`) + repairs canonical source relations.
- **support-database-hygiene-pass** (`:133`): duplicate support entries; canonical-vs-duplicate merge plans incl. hardcoded forced-merge list + canonical ID pins; rewrites project→support relations.
- **stale-support-audit** (`:142`): READ-ONLY. Classifies support by linked-project count (orphaned/weak/actionable vs intentional). Emits review queues; repairs nothing.
- **fill-empty-local-project-fields** (`:158`, `buildFieldPlan :338`): backfills blank project fields from intelligence + build sessions + workflow-run events + support relations.
- **github-notion-catch-up** (`:203`, `buildRepoPlans :372`): creates rows for repos on GitHub but missing in Notion; seeds manual signals.
- **create-local-project-rows-from-truth** (`:158`): targeted creation from a truth snapshot for explicit `--project-title` args; throws on title not in snapshot.

## COMMAND SURFACE

`cliRegistry` (`registry.ts:102`) — 2-level tree. **5 simple top-level commands** (`publish`, `doctor`, `destinations`, `profiles`, `logs`) + **8 families** (control-tower 16, governance 11, signals 7, intelligence 4, execution 2, rollout 2, bridge-db 2, maintenance 1) — **≈49 executable commands**, plus ~6 standalone maintenance scripts outside the registry.

**Dry-run/live convention**: uniform `--live` opt-in (`commonOptions.live` `:75-79`); `action-runner` uses `--mode {dry-run,live}`.

**Rollout semantics**: graduating projects from Notion-only into the GitHub-actuation lane. `classifyOperationalRolloutProject` (`operational-rollout.ts:425`) requires `operatingQueue ∈ {Resume Now, Worth Finishing, Needs Decision}`, assigns `move to GitHub next` / `keep Notion-only` / `not worth migrating yet` based on repo-mapping maturity, ship-readiness, local-operability, setup-friction (`:450-540`). `cohort-rollout.ts` drives a fixed ordered cohort through the same classifier.

## ROUGH EDGES

- **Hardcoded Notion UUIDs in maintenance code.** `INTAKE_PROJECTS_DATA_SOURCE_ID` literal in `notion-hygiene-pass.ts:~43`, re-hardcoded (not imported) in `github-notion-catch-up.ts:~245`. `support-database-hygiene-pass.ts:~24-35` pins canonical page IDs + forced-merge list as raw UUIDs. Silent drift risk on workspace rebuild.
- **`--project-concurrency` misleading at orchestrator level** — orchestrator loop is strictly sequential; flag only forwards to children.
- **`--step-timeout-minutes` all-or-nothing** — collapses tiered 10/15/20-min defaults; low value SIGTERMs the 20-min external-signals lane.
- **Retry gate hinges on error-message classification** (`:569`, generic child-timeout Error `:647`) — brittle.
- **Preflight and live build step definitions twice, independently** (`:179`, `:200`) — nondeterminism means live may not execute exactly what preflight validated.
- **control-tower failure = binary skip-cascade** (`:513-517`) — one CT failure skips 4 downstream lanes wholesale.
- **Silent post-live freshness degradation** (`:1178-1181`, `:1191-1195`) — freshness-patch failures swallowed while run reports success; command-center can be left stale.
- **stale-support-audit has no wired remediation** — actionable queue relies on a human reading output.

Key files: `src/notion/weekly-refresh.ts`, `src/notion/http.ts`, `src/config/runtime-config.ts`, `src/cli/registry.ts`, `src/notion/operational-rollout.ts`, `cohort-rollout.ts`, and `src/internal/notion-maintenance/*`.
