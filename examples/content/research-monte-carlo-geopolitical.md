---
title: "Monte Carlo Confidence Bands for Geopolitical Simulation"
---

# Monte Carlo Confidence Bands for Geopolitical Simulation

## Summary

Research into structuring Monte Carlo simulation for geopolitical influence propagation: influence graph design, noise modeling, confidence band generation, and calibration methodology.

## Key Findings

- 50 runs is sufficient for stable p10/p50/p90 confidence bands with σ=0.15× Gaussian noise — diminishing returns beyond 100 runs, visible instability below 20
- 60 monthly propagation steps (5-year horizon) is the right length for policy lever effects to cascade through 18-country influence graphs before diverging
- Influence graph must distinguish: trade volume edges (symmetric), alliance edges (asymmetric), and sanctions edges (directional + asymmetric) — treating all edges as uniform produces calibration failures
- Historical calibration requires clear "ground truth" outcome definitions — vague scenario outcomes cannot be machine-scored, must be binary or range-bounded
- DECAY_FACTOR for influence attenuation (each hop loses ~15% signal strength) was more impactful than noise σ on calibration accuracy
- Web Worker via Comlink is the correct architecture for browser-side Monte Carlo — synchronous main-thread simulation blocks UI during 50-run passes (measured: 2-4 seconds on M1)
- URL-encoded scenario state (base64 JSON of SimConfig) is sufficient for sharing — no backend needed for read-only scenario links

## Actionable

SimulationWorker + Comlink + Zustand results store pattern is reusable for any browser-side stochastic simulation. The influence graph schema (country nodes + typed weighted edges) is portable to other geopolitical or network propagation models.
