---
title: "TradeOffAtlas: Feature Complete — Decision Modeling + Sensitivity Analysis"
---

# Build Log Entry

## What Was Planned

Build a local-first Tauri 2.0 desktop app for multi-criteria decision modeling. Four phases: foundation + scoring engine, decision canvas UI, sensitivity analysis, templates + history.

## What Shipped

**Phase 0 — Foundation:**
- Tauri 2.0 scaffold with SQLite schema (7 tables)
- Pure scoring engine in `lib/scoring.ts`: `computeWeightedScore`, `rankOptions`, `detectRankChanges`
- Full unit test coverage for scoring functions (zero side effects, fully testable)

**Phase 1 — Decision Canvas:**
- Create/edit decisions with options and weighted criteria
- Scoring matrix (0-10 scale) with live weighted totals
- Auto-ranked options with normalized scoring: `weightedTotal / maxPossibleScore * 100`

**Phase 2 — Sensitivity Analysis:**
- Weight sliders (0-10) with live radar chart updates via Recharts
- Rank-change alerts when weight shifts cause re-ordering
- Bar chart visualization for option comparison
- "Reset to Baseline" and "Save as new baseline" for weight overrides
- In-memory analysis (doesn't write to DB until explicitly saved)

**Phase 3 — Templates + History:**
- Save any decision's criteria as reusable templates
- Apply templates to new decisions with one click
- Archive decisions with outcome selection and notes
- Full read-only matrix replay in history view

**Phase 4 — Advanced Features (beyond initial roadmap):**
- Keyboard shortcuts: Cmd+1-6 for view navigation
- CSV and PDF export with file save dialog
- Decision history search with date filtering
- Global modal state management via Zustand
- Window minimum size enforced at 1200x800

## Key Decisions

- Zustand over Redux — simpler for solo app, avoids prop drilling and boilerplate
- In-memory sensitivity analysis — weight changes are ephemeral until explicitly saved
- Rank-change delta threshold — flags when any option swaps rank position
- Template storage in DB (not file export) — queryable, no filesystem permission complexity
- Unique constraint on (optionId, criterionId) for score integrity

## Next Steps

- Push to GitHub (done)
- Wire into Notion signal pipeline (done)
- Add comparison mode (side-by-side decisions)
- Consider collaborative features for team decision-making
