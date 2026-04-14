# Weekly Refresh Cutover Review

Historical note: this document captured the abandoned live-cutover path for the weekly-refresh lane.

It is no longer the current recommendation.

## Current Status

The current operating model is Option 2, documented in [`weekly-notion-maintenance-operating-model.md`](./weekly-notion-maintenance-operating-model.md).

That means:

- there is no active plan to promote an unattended live weekly-refresh automation
- `weekly-refresh-shadow` is historical and paused
- `weekly-github-notion-maintenance` is historical and paused
- `weekly-command-center` is historical for this stream and paused
- live weekly-refresh writes are manual operator actions when the weekly digest recommends them

## Why This Document Still Exists

Keep this file as a record of:

- the original Phase 2 promotion criteria
- the old cutover and rollback thinking
- the evidence that led to the later operating-model change

Do not use this file as an active checklist for weekly operations.
