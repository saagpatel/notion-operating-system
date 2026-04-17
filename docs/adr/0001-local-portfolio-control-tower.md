# ADR 0001: Local Portfolio Projects is the project control tower

- Status: Accepted
- Date: 2026-03-17

## Context
The repo already contains durable direct Notion REST publishing, live schema upgrades, and MCP-driven saved view sync. A newer Local Portfolio Projects database exists alongside the older scored Project Portfolio database. The operating system needs one clear project control surface for day-to-day PM review without destroying the older strategic scoring system.

## Decision
Use Local Portfolio Projects as the operational project control tower. Keep the older Project Portfolio database intact for legacy strategic scoring, but do not use it as the day-to-day execution-facing source of truth.

## Alternatives Considered
- Continue using the older Project Portfolio database as the operational source of truth.
- Merge both project databases into one immediately.
- Keep the operating model implicit in chat history and ad hoc Notion pages.

## Consequences
- The control-tower logic can stay additive and non-destructive.
- The repo can own derived PM signals, review cadence, and memory artifacts around one operational database.
- Cross-database relations from Build Log, Weekly Reviews, Research Library, Skills Library, and AI Tool & Site Matrix can converge on one project operating surface.

## Supersession Guidance
If a future phase replaces Local Portfolio Projects as the control tower, add a new ADR instead of silently rewriting this one.