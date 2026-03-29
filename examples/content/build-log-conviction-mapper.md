---
title: ConvictionMapper — V1 Build (Belief Graph + Prediction Tracking)
---

# Build Log Entry

## What Was Planned
Build a local-first macOS desktop app for mapping personal belief systems as a force-directed graph. Phase 0 foundation through V1 feature complete: SQLite schema, Rust/Tauri command layer, D3.js force simulation with direct DOM ownership, belief CRUD, evidence chains, decay curves, and prediction tracking with calibration scores.

## What Shipped
- SQLite schema: beliefs, evidence, connections, updates, app_settings tables with WAL mode
- Full Rust/Tauri command layer: get/upsert/delete for beliefs, evidence, connections, updates
- D3.js v7 force simulation with useRef + tick callbacks — D3 owns SVG DOM directly
- BeliefPanel slide-in detail view with evidence chain editor
- QuickAdd (⌘N) and DeepAdd (⌘⇧N) overlays for belief entry
- Exponential decay formula: `0.15 + 0.85 * e^(-ln(2)/half_life * days)` — dims but never vanishes
- Domain filter chips, view toggle (graph/list), minimap (200×120px canvas)
- Prediction tracking: calibration scores, graph rings, BeliefPanel integration
- Settings: decay config, domain management, export/import
- Command palette and time-travel history

## Next Steps
Continue toward V2: Ollama integration for AI-assisted belief analysis, connection suggestions, and evidence quality scoring.
