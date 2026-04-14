---
name: weekly-notion-maintenance
description: Run the report-only weekly Notion maintenance review and recommend manual live follow-up only when warranted.
---

# weekly-notion-maintenance

## Beginner At A Glance
- What this skill does: Reviews the weekly Notion maintenance state without mutating anything, then produces one decision-ready report.
- Use this when: Use when you want the weekly dry-run digest for Notion operations.
- Say it naturally: "Run the weekly Notion maintenance review" | "Check this week's Notion drift" | "Do the report-only weekly maintenance pass"

## Goal

Produce one report-only weekly Notion maintenance review for `/Users/d/Notion`.

This skill is for observation and recommendation only. It must never perform repo mutation, Notion mutation, automation mutation, or any other external-system mutation.

## Required Workflow

1. Read the automation memory first if it exists and use it to suppress unchanged low-signal drift from prior runs.
2. Run exactly these commands in dry-run mode only:

```bash
npm run portfolio-audit:github-support-maintenance
npm run maintenance:weekly-refresh
```

3. Create exactly one inbox item with exactly these section headings in order:
   - `Priority Summary`
   - `Dry-Run Drift`
   - `Manual Follow-Up`
4. Keep `Manual Follow-Up` to at most 3 concrete actions.

## Decision Rules

- If both dry runs are clean and `needsLiveWrite=false`:
  - say no live run is needed
  - set `can_auto_archive=true`
- If weekly refresh shows drift, but `failed=0` and `partial=0`:
  - recommend exactly `npm run maintenance:weekly-refresh -- --live`
  - explain that this is normal weekly lag, not a system failure
- If any weekly-refresh step is `failed` or `partial`:
  - do not recommend a live run
  - recommend only targeted dry-run follow-up commands for diagnosis
- If support maintenance is clean but weekly refresh drifts:
  - treat this as a weekly Notion refresh decision, not a GitHub support maintenance incident

## Reporting Rules

- Surface only net-new or still-unresolved drift worth attention this week.
- Avoid re-reporting unchanged low-signal drift from prior runs.
- Make it clear that the Command Center and weekly review packet may lag between manual live refreshes.
- If weekly refresh depends on shared local state, stay on the primary checkout at `/Users/d/Notion`.

## Guardrails

- Report-only only: no repository mutation, no external-system mutation, no sends, and no silent state changes.
- Never run `npm run maintenance:weekly-refresh -- --live` from this skill.
- Never change automation state from this skill.
