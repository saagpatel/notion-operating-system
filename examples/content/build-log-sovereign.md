---
title: Sovereign — Phase 0 Foundation (Monte Carlo Simulation Engine)
---

# Build Log Entry

## What Was Planned
Build the foundation for a client-side geopolitical simulation tool: static Next.js export, Web Worker Monte Carlo simulation engine, D3-geo world map, and calibration tooling. Phase 0 acceptance criteria: simulation produces stable confidence bands, calibration route validates against 7 historical scenarios.

## What Shipped
- Next.js 14 App Router with `output: 'export'` static build, fully client-side
- SimulationWorker.ts via Comlink: 50-run Monte Carlo, 60 monthly propagation steps per run
- Gaussian noise per influence edge (σ=0.15×), posts progress every 10 runs
- countryData.json: hardcoded 2025 baseline state vectors for 18 countries/blocs
- D3-geo world map: geoNaturalEarth1 projection, ChoroplethLayer + ConnectionLayer
- TimelineScrubber: month 0–60 slider with 16ms debounce
- MetricPanel: Recharts ComposedChart with p10/p50/p90 confidence band overlay
- LeverPanel: domain selector + −100→+100 policy slider with labeled positions
- ScenarioLibrary: 8 prebuilt scenario cards + freeform toggle
- Calibration debug route (`/calibration`): historical target runner, 7/7 targets pass
- DECAY_FACTOR and shock multiplier calibration from historical data

## Next Steps
Phase 1: UI polish, scenario sharing (URL-encoded state), World Bank API data refresh flow, deployment to self-hosted nginx.
