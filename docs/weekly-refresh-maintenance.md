# Weekly Refresh Maintenance

Historical note: this document describes the original Phase 2 weekly-refresh rollout and live-cutover plan.

It is no longer the active operating guide.

## Current Source Of Truth

Use [`weekly-notion-maintenance-operating-model.md`](./weekly-notion-maintenance-operating-model.md) for the current weekly Notion operating model.

That document reflects the adopted Option 2 posture:

- `weekly-notion-maintenance` is the active weekly lane
- the weekly lane is report-only
- live weekly refreshes are manual operator actions
- the old shadow and cutover path is retained only as history

## Why This Document Still Exists

This document remains useful for understanding:

- what the weekly-refresh orchestrator does
- what the original live-cutover path was
- how the rollout reasoning evolved during hardening

Do not use this file as the current cutover checklist or weekly operations guide.
