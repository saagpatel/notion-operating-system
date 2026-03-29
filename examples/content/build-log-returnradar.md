---
title: "ReturnRadar: v2.0 Complete — Receipt Tracking + Warranty + Notifications"
---

# Build Log Entry

## What Was Planned

Build a local-first macOS desktop app to track purchase return windows, mail-in rebate deadlines, and warranty expiry dates with native notifications. Six phases from foundation through warranty tracking.

## What Shipped

**Phase 0 — Foundation:**
- Tauri 2.x scaffold with SQLite schema and migration runner
- Tailwind CSS 4.x + shadcn/ui component setup

**Phase 1 — Purchase Log:**
- Full purchase CRUD with deadline tracking
- Dashboard stat cards: expiring this week, open returns, pending rebates, total recoverable $
- Cmd+N quick-add shortcut

**Phase 2 — Rebates + Notifications:**
- Rebate tracker with status flow
- Native macOS notifications at 7-day and 1-day marks
- launchd login agent for notifications when app is closed
- Notification deduplication via `notification_log` table

**Phase 3 — Polish:**
- Edit/delete flows with inline status updates
- Settings page with notification toggles

**Phase 4 — Visual Polish + UX:**
- Dark mode refinements across all views

**Phase 5 — Receipt Parsing:**
- Claude API integration: forward email receipt attachments, auto-populate purchase fields
- Structured data extraction (item, price, date, vendor)

**Phase 6 — Warranty Tracking:**
- Full warranty module with same deadline/notification mechanics as returns
- Pre-seeded 20-retailer database with configurable return window defaults

## Key Decisions

- launchd login agent (not daemon) for background notifications — simpler, no service management
- Integer cents for all price storage — no float precision issues
- Pre-seeded 20 retailers to eliminate common entry friction
- Schema versioning from day one with ordered migrations
- Notification dedup prevents spam for the same deadline

## Next Steps

- Push to GitHub (done)
- Wire into Notion signal pipeline (done)
- Polish review: verify all notification flows end-to-end
- Consider App Store packaging
