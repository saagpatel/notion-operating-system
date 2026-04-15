# Phase 10 Roadmap: Signal Consolidation and AI Synthesis

Generated: 2026-04-14. Context: post-Phase-9 cleanup session brainstorm.

---

## What This Document Is

This is the pre-compaction reference document for the next major phase of the Notion Operating System. It captures the findings from a deep machine audit + web research session and translates them into a concrete, sequenced roadmap.

---

## Where the System Stands Today (Post Phase 9 Cleanup)

- `main` is clean. All PRs merged. No stale branches. No worktrees.
- 114 projects tracked. Health report: `status: healthy`, `warningCount: 0`.
- 39 test files, 210 tests passing.
- 34 one-off batch scripts deleted (~22k lines removed).
- README rewritten. Phase 9 roadmap closed out.
- Weekly live sequence completed: control tower, review packet, GitHub signals, recommendations, action-request sync all clean.
- The three proven lanes: governed GitHub actions (6 action types), governed Vercel actions (redeploy, rollback, promote).

**The fundamental gap:** The system is excellent at receiving configuration and executing governed actions, but it doesn't yet observe what's happening across your tools, and it produces no daily-consumable AI synthesis. The inbound signal graph is thin. The AI layer is absent.

---

## The Core Insight from the Audit

Three projects on this machine already produce the data the Notion OS needs. None of them are wired to it yet.

### GithubRepoAuditor (`/Users/d/Projects/GithubRepoAuditor`)

- **What it is:** Python portfolio OS. Clones every repo, runs 12 analyzers (docs, tests, CI, deps, activity, security, structure, community), produces dual-axis scores with letter grades (A–F), drives a weekly operator loop.
- **Current maturity:** Phases 0–27 + 103–108 complete. 799 tests. Schema 0.4.0. Risk overlay shipped.
- **Outputs:** `output/audit-report-*.json`, `output/audit-diff-*.json`, `output/audit-dashboard-*.xlsx`, `output/context-recovery-plan-*.json`, SQLite history DB.
- **Partial Notion wiring already exists:** `src/notion_client.py`, `notion_dashboard.py`, `notion_export.py`, `notion_registry.py`, `notion_sync.py`. Reads from `Local Portfolio Projects` via `config/notion-project-map.json`. Can push audit signal events — but to a legacy path, not the canonical `external_signal_events` destination.
- **The gap:** Redirect `notion_sync.py` output to `external_signal_events`. One adapter. The payoff: every project row gets a live "Repo Health Score" that degrades over time and triggers review cadence when it drops.

### notification-hub (`/Users/d/Projects/notification-hub`)

- **What it is:** Python FastAPI event intake and routing hub. Accepts `POST /events` from Claude Code, Codex, and Claude.ai. Classifies urgency. Fans out to macOS push notifications, Slack webhook, and a local JSONL event log. Also watches bridge-db markdown for changes.
- **Data it owns:** JSONL event log — every notification ever fired from any AI system. Fields: `source`, `level`, `title`, `body`, `project`, `event_id`, `received_at`, `classified_level`.
- **The gap:** Zero Notion integration exists. A nightly sync worker reading the JSONL log and writing to `external_signal_events` gives Notion a live cross-agent activity stream. The schema maps directly: `source` → Source, `level` → urgency, `project` → relation to `local_portfolio_projects`.

### bridge-db (`/Users/d/Projects/bridge-db`)

- **What it is:** SQLite-backed MCP server (WAL mode). Shared state bus between Claude.ai, Claude Code, and Codex. 16 typed MCP tools across 6 modules.
- **Tools:** `activity` (log_activity, get_recent_activity, get_shipped_events, mark_shipped_processed), `handoffs` (create_handoff, get_pending_handoffs, pick_up_handoff, clear_handoff), `context` (update_section, get_section, get_all_sections), `snapshots` (save_snapshot, get_latest_snapshot), `cost` (record_cost, get_cost_history), `export` (export_bridge_markdown → `~/.claude/projects/-Users-d/memory/claude_ai_context.md`).
- **Data it owns:** SQLite at `~/.local/share/bridge-db/bridge.db` — activity log, handoffs queue, context sections, snapshots, cost history.
- **The gap:** `get_shipped_events` + `mark_shipped_processed` is a natural polling target. Anything an agent marks "shipped" should propagate to `build_log`. Pending handoffs could become `work_packets` rows. Cost history is a signal row. No Notion writer exists yet.

---

## The Existing Notion Database Landing Zones

From `config/destinations.json`. The `external_signal_*` family is the primary receptor for all three projects above.

| Alias | Purpose |
|---|---|
| `external_signal_sources` | Registry of signal producers (GitHub repos, ASC apps, etc.) |
| `external_signal_events` | Individual signal events — the main feed |
| `external_signal_sync_runs` | History of sync runs |
| `build_log` | Build sessions — natural target for bridge-db shipped events |
| `work_packets` | Work in progress — natural target for bridge-db handoffs |
| `local_portfolio_projects` | The 114-project control tower — receives derived fields |
| `weekly_reviews` | Weekly review pages — receives managed section patches |
| `research_library` | Research notes — could receive thought-trails session exports |

---

## Phase 10 Roadmap: Eight Initiatives

### Initiative 1 — notification-hub → Notion Signal Sync
**Priority: Highest. Lowest effort, highest signal density.**

Build a Python sync worker that reads the notification-hub JSONL event log and writes new entries to `external_signal_events` in Notion. Use a watermark (last-synced `event_id`) to avoid re-processing. Run on demand or nightly via a new `portfolio-audit:notification-sync` npm script.

Each event maps to:
- Source → "notification-hub" (new External Signal Source row)
- project field → relation lookup in `local_portfolio_projects`
- level → urgency/priority field
- title + body → event description
- received_at → timestamp

This single adapter gives Notion a live cross-agent activity stream spanning every Claude Code session, Codex run, and Claude.ai conversation that has ever fired a notification.

**Implementation path:** New TypeScript adapter at `src/notion/notification-hub-sync.ts`, wired into the existing `external-signal-sync` framework as a new provider type. No new infrastructure beyond reading a JSONL file.

---

### Initiative 2 — bridge-db Shipped Events → build_log
**Priority: High. Closes the AI agent activity loop.**

Add a polling adapter that calls bridge-db's `get_shipped_events`, writes each to `build_log` in Notion, then calls `mark_shipped_processed` to advance the watermark. Run as part of the weekly sequence or on demand.

Each shipped event maps to:
- title → build log entry title
- project → relation to `local_portfolio_projects`
- source (Claude Code / Codex / Claude.ai) → Tags field
- timestamp → Session Date

Bridge-db handoffs → `work_packets` is Phase 2 of this initiative. Lower urgency than the shipped events feed since handoffs are transient.

**Implementation path:** New TypeScript adapter `src/notion/bridge-db-sync.ts`. Reads bridge-db SQLite directly (the DB path is `~/.local/share/bridge-db/bridge.db`) or via the MCP tools if the server is running. Wire into CLI as `notion-os bridge-db sync`.

---

### Initiative 3 — GithubRepoAuditor → external_signal_events
**Priority: High. Partial wiring already done.**

Redirect the auditor's existing `notion_sync.py` output (or write a new TypeScript adapter) to push per-repo audit grades to `external_signal_events` instead of the legacy path. Each audit run produces a signal event per repo with:
- Grade (A–F) as the signal value
- Delta from last run (grade improved / degraded / unchanged)
- Dimension scores (docs, tests, CI, security, activity)

The derived field payoff: `local_portfolio_projects` gets a "Repo Health Score" and "Last Audit Grade" that the control-tower-sync can incorporate into Evidence Freshness calculations.

**Implementation path:** Either extend `notion_sync.py` to write to the canonical destination (Python path), or write a TypeScript shim that reads `output/audit-report-*.json` and pushes to Notion (TypeScript path). The TypeScript path keeps all Notion writes in one codebase.

---

### Initiative 4 — Morning Brief Output Lane
**Priority: High. No new infrastructure.**

A new CLI command (`notion-os control-tower morning-brief`) that:
1. Reads the current Operating Queue from Notion (top 5 Resume Now + Worth Finishing projects)
2. Reads each project's derived fields (Evidence Freshness, Last Active, Open PR count, Recommendation Score, Next Move)
3. Calls Claude API to synthesize a paragraph per project: why it's at the top, what the specific next move is, what's blocking
4. Writes the brief as a managed section on today's date in the Command Center page, or as a standalone Notion page

The brief is the "what do I work on today and why" answer. Distinct from the weekly review packet (retrospective) — this is prospective and daily.

**Implementation path:** New `src/notion/morning-brief.ts`. Uses the existing `managed-markdown-sync` pattern for output. Requires `ANTHROPIC_API_KEY` in env. Use prompt caching for the project context (stable) vs. the synthesis instruction (variable).

---

### Initiative 5 — Orphaned Project Classification Pass
**Priority: Medium-High. Eliminates meaningful dead weight.**

50 projects have `buildSessionCount === 0 AND relatedResearchCount === 0 AND supportingSkillsCount === 0 AND linkedToolCount === 0`. They're not corrupted — they just have no operating evidence.

An LLM classification pass reads each orphaned project's title, category, summary, and portfolio call, then buckets it:
- **Viable — needs a kickoff entry:** The idea is solid, just has no logged activity yet
- **Superseded:** Another project on the portfolio covers the same ground
- **Archive candidate:** Low novelty, low activation energy, no clear path

Output: A single Notion governance page with a table of all 50 projects and recommended dispositions. Operator batch-approves. The approved dispositions flow back as `work_packets` (kickoff) or status updates (archive).

**Implementation path:** New `src/notion/orphan-classification.ts`. Batch LLM calls with project data. Output to a new page in the Command Center hierarchy.

---

### Initiative 6 — App Store Connect Signal Lane
**Priority: Medium. Pattern already proven.**

For the 9 iOS apps near App Store submission, a signal lane polling ASC (via the `mcp__asc-mcp__*` tools or the REST API directly) writes:
- Build processing state (processing / ready / failed)
- TestFlight build age (days since last TestFlight upload)
- App Store review status (waiting / in review / approved / rejected)
- Crash rate from ASC analytics

These become derived fields on `local_portfolio_projects` rows, same pattern as GitHub PR count and Last Deployment Status.

**Implementation path:** New provider adapter in `src/notion/external-signal-sync.ts` alongside the existing GitHub adapter. Requires `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` in env (JWT auth).

---

### Initiative 7 — Historical Trending + Anomaly Detection
**Priority: Medium. Infrastructure cost but high long-term value.**

Currently derived fields are point-in-time snapshots. Add an append-only `Signal History` table (new Notion database or local SQLite) that stores weekly snapshots of key derived fields per project. A weekly LLM pass flags:
- "Evidence Freshness declining 3+ consecutive weeks for project X"
- "Operating Queue rank jumped 5+ positions without a build session"
- "8 projects have had 'Needs Review' status for 30+ days"

Output as a `governance_health_status` field on the weekly review page ("trending" section), or as a warning in the health report.

**Implementation path:** Extend `control-tower-sync` to append to a history table on each run. Add a new `trend-analysis` command that reads history and synthesizes anomalies.

---

### Initiative 8 — Vercel Analytics Signal Lane
**Priority: Lower. Completes the deploy loop.**

Currently: governed Vercel actions (redeploy, rollback, promote) write to Notion. Missing: reading Vercel analytics back in. A signal lane polling the Vercel analytics API per project writes:
- p95 latency trend (improving / degrading)
- Error rate (last 7 days vs. prior 7 days)
- Visitor delta (growth / decline)

These become "Deployment Health Score" on the project row. Completes the loop: deploy → monitor → PM signal → potential rollback action.

**Implementation path:** New adapter in `external-signal-sync`. Requires `VERCEL_TOKEN` (already in env).

---

## Sequencing Recommendation

**Phase 10A — Signal Wiring (do first):**
1. notification-hub → Notion (Initiative 1)
2. bridge-db shipped events → build_log (Initiative 2)
3. GithubRepoAuditor → external_signal_events (Initiative 3)

These three together give the Notion OS a complete picture of what's actually happening across all your tools. They're all adapters — no new Notion schema needed, no new databases.

**Phase 10B — AI Synthesis (do second, after signal graph is richer):**

4. Morning Brief (Initiative 4)
5. Orphaned project classification (Initiative 5)
6. Historical trending + anomaly detection (Initiative 7)

The synthesis layer is more valuable when it has more signals to reason over. Do the wiring first.

**Phase 10C — New Signal Sources (do when operationally relevant):**

7. ASC signal lane (Initiative 6) — when you're actively submitting iOS apps
8. Vercel analytics (Initiative 8) — when you want deploy loop closure

---

## Config Changes Required for Phase 10A

New External Signal Source rows needed in Notion:
- `notification-hub` (provider: local, type: event log)
- `bridge-db` (provider: local, type: SQLite)
- `GithubRepoAuditor` (provider: local, type: JSON output)

New env vars needed:
- `BRIDGE_DB_PATH` — path to `~/.local/share/bridge-db/bridge.db`
- `NOTIFICATION_HUB_LOG_DIR` — path to the notification-hub JSONL event log
- `GITHUB_AUDITOR_OUTPUT_DIR` — path to `GithubRepoAuditor/output/`
- `ANTHROPIC_API_KEY` — for morning brief (Initiative 4)

New destination alias needed (if trend history goes to Notion):
- `signal_history` — append-only field snapshot table

---

## Key Architectural Principle for Phase 10

All three Phase 10A adapters follow the same pattern as the existing GitHub signal lane:
1. Read from source (file, SQLite, JSON)
2. Deduplicate against existing Notion rows (by event_id or equivalent)
3. Write new events to `external_signal_events`
4. Write a sync run summary to `external_signal_sync_runs`
5. Update project-level derived fields on `local_portfolio_projects`

The existing `external-signal-sync.ts` framework already handles steps 3–5. Each new adapter only needs to implement steps 1–2 as a new provider.

---

## Session Handoff Notes

- This brainstorm happened in the same session as Phase 9 cleanup (PRs #27 and #28 merged)
- The machine audit confirmed: notification-hub JSONL exists and is populated, bridge-db SQLite is at `~/.local/share/bridge-db/bridge.db`, GithubRepoAuditor has partial Notion wiring in `src/notion_sync.py`
- The web research confirmed: Morning Brief / daily digest is the standard emerging interface for AI second brains; signal aggregation across tools is the core gap in most personal OS setups
- Next session should start with Initiative 1 (notification-hub sync) — lowest effort, proves the local-provider pattern, gives immediate observability value
