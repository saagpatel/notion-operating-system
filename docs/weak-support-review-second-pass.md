# Weak Support Review - Second Pass

Date: 2026-03-29

## What this review is

This is a review-first checkpoint for the remaining weakly linked support rows after the recent reuse batches.

At this point:

- orphaned support rows are already cleared
- the easy shared rows have already been linked
- most remaining rows are specialized and may be intentionally single-project

The goal of this pass is to avoid over-linking niche support rows just to reduce the audit count.

## Current audit snapshot

- `stale-support-audit`: 78 total candidates
- orphaned rows: 0
- weak rows: 78
- actionable weak rows: 0
- intentionally single-project rows: 77
- weak research rows: 57, all intentionally single-project
- weak skill rows: 16, all intentionally single-project
- weak tool rows: 4, all intentionally single-project

Interpretation:

- the queue is no longer a cleanup problem
- the classification problem is solved for the current backlog
- almost every remaining weak row is now explicitly treated as intentionally single-project
- there are no remaining actionable weak-link rows after the final reuse write

## Rows that should stay review-first

These rows should not be force-linked without fresh repo evidence from a second project.

### Specialist skills

1. `CrewAI`
   Current state: only linked to `Nexus`
   Recommendation: keep as single-project until another live repo clearly uses CrewAI.

2. `Elo / Statistical Models`
   Current state: only linked to `ModelColosseum`
   Recommendation: keep as single-project unless another project clearly implements rating systems or comparable ranking logic.

3. `Prisma`
   Current state: only linked to `prompt-englab`
   Recommendation: keep as single-project for now; no second repo-backed Prisma usage was confirmed in this pass.

4. `TypeScript Build Hygiene`
   Current state: now linked to `Premise`, `JobCommandCenter`, and `DatabaseSchema`
   Recommendation: no longer a weak-link candidate after the final reuse pass.

Additional rows now explicitly classified as intentionally single-project:

- `iOS Export Pipeline (AVAssetWriter + PHPhotoLibrary)`
- `Local Argument Mapping with React Flow + SQLite`
- `Metal GPU Particle Simulation (iOS)`
- `Monte Carlo Simulation via Web Worker (Comlink)`
- `Prompt Evaluation & Versioning`
- `Transparent Click-Through macOS Overlay via Tauri`

### Specialist tools

1. `Prisma`
   Current state: only linked to `prompt-englab`
   Recommendation: same as the skill row; do not reuse until a second Prisma-backed project is confirmed.

2. `NOAA CO-OPS API`
   Current state: only linked to `TideEngine`
   Recommendation: keep as single-project unless another shipping repo clearly integrates the same API.

3. `Polygon.io Market Data API`
   Current state: only linked to `GlassLayer`
   Recommendation: keep as single-project unless another live market-data project clearly uses Polygon.io.

4. `World Bank Open Data API`
   Current state: only linked to `Sovereign`
   Recommendation: keep as single-project unless another live project clearly integrates the same API.

### Project-specific skills created from recent coverage work

Examples:

- `ARKit LiDAR Room Scanning`
- `AVAudioEngine Real-Time Synthesis`
- `Belief Graph & Confidence Decay Modeling`
- `Calibration Game Architecture with SwiftUI + CloudKit`
- `CoreMotion`
- `D3 Force-Directed Graph (Direct DOM)`
- `D3-Geo World Map with Choropleth`

Recommendation:

- treat these as intentionally narrow unless a second project clearly shares the same implementation pattern
- do not archive them just because they have one linked project

## Research rows that are now intentionally single-project

The recent classification expansion moved the remaining weak research rows into the intentional bucket because they read like project findings, not reusable library entries.

Examples:

- `Weekly Reviews Should Roll Up From Build Log`
- `Activity-Driven Ticket Docs Need Privacy Sanitization and Local Model Proof`
- `Agent Workflow Observability Needs Session Discovery, Delegation Graphs, and Tool-Level Inspection`
- `Assistant-Safe Personal Control Planes Need Shared Context, Approval Gates, and Local Audit Trails`
- `Data Extraction Extensions Should Try DOM First and Use Vision Only for Hard Cases`
- `GitHub Pages Is a Real Blocker, Not Just Deployment Noise`
- `Menu Bar System Monitors Need Fast Sampling, Local History, and Thresholded Alerts`
- `Local Semantic Search Should Stay Optional and Bounded`
- `macOS Native Notification Patterns for Desktop Apps`
- `Room Acoustic Mode Calculation and Spatial Audio`
- `Afterimage: on-device historical photo matching baseline`
- `Package-Backed Native Apps Need App and Package Runtime Checks`

Recommendation:

- keep these rows
- do not merge or archive them during weak-link cleanup
- only expand them to a second project when a later project really shares the same lesson or implementation pattern

## What changed in the last reuse wave

The recent specialist passes were still worth doing because they were backed by clear cross-project evidence:

- `Slack Platform` now links to both `SlackIncidentBot` and `AIWorkFlow`
- `Privacy / Data Sanitization` now links to both `TicketDocumentation` and `IncidentReview`
- `GitHub Pages` now links to both `PomGambler-prod` and `TerraSynth`

This is the standard to keep using.

## Recommended next action

Do not keep shrinking the queue with low-confidence manual links.

The better next step is:

1. Treat the remaining weak rows as a review list, not a cleanup failure.
2. Keep future live linking limited to rows with explicit second-project repo evidence.
3. Treat the remaining 77 rows as intentional single-project watchlist items until a later repo clearly proves reuse.

## What changed in the audit

The classification layer now absorbs the long tail of recent project-specific support rows instead of treating them like unfinished cleanup work.

That makes the audit decision-useful again:

- it no longer asks for force-linking one-project research notes
- it keeps specialist skills and tools visible without mislabeling them as debt
- it leaves a very small true follow-up queue for future evidence-backed reuse
