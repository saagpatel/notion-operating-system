---
title: Monte Carlo Simulation via Web Worker (Comlink)
---

# Monte Carlo Simulation via Web Worker (Comlink)

Type-safe Monte Carlo simulation in a Web Worker using Comlink for RPC, with progress streaming and p10/p50/p90 confidence band output.

## Demonstrated Capabilities

- Comlink 4.x: type-safe RPC between main thread and Web Worker — no postMessage boilerplate
- 50-run Monte Carlo with 60 monthly propagation steps per run on an 18-node influence graph
- Gaussian noise injection per influence edge: σ=0.15× of base weight per propagation step
- Progress events every 10 runs (streamed to main thread via Comlink observable pattern)
- Output: p10/p50/p90 percentile bands per country per month — never raw run data
- Calibration debug route: historical scenario runner validates against known outcomes
- Zustand simStore integration: results stored in-memory only, never persisted to localStorage
- Next.js dynamic import guard: D3 + Web Worker always imported client-side only
