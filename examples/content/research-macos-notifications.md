---
title: "macOS Native Notification Patterns for Desktop Apps"
---

# macOS Native Notification Patterns for Desktop Apps

## Summary

Research into reliable notification delivery on macOS for local-first desktop apps, including launchd scheduling, deduplication strategies, and Tauri notification plugin limitations.

## Key Findings

- launchd login agents (not daemons) are the correct mechanism for user-scoped background tasks on macOS — simpler permissions model, no root required
- Notification deduplication requires persistent tracking (DB table) — macOS Notification Center does not deduplicate on behalf of apps
- Tauri's notification plugin handles basic push but not scheduled/recurring notifications — launchd fills this gap
- 7-day and 1-day reminder intervals cover the vast majority of deadline awareness use cases without notification fatigue
- Pre-seeded retailer data with sensible return window defaults eliminates the most common data entry friction

## Actionable

Pattern validated in ReturnRadar v2.0. Reusable for any Tauri desktop app needing scheduled local notifications on macOS.
