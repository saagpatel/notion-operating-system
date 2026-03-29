---
title: "Epistemic Decay Modeling for Personal Knowledge Systems"
---

# Epistemic Decay Modeling for Personal Knowledge Systems

## Summary

Research into modeling belief staleness through confidence decay curves, evidence chain weighting, and prediction calibration feedback loops for personal epistemics.

## Key Findings

- Exponential decay `0.15 + 0.85 * e^(-ln(2)/half_life * days)` with configurable half-life is the most interpretable decay model: flooring at 0.15 prevents complete belief erasure while making staleness visually obvious
- Half-life should be per-domain, not global: geopolitical beliefs decay faster (~90 days) than physics beliefs (~1000 days)
- Evidence chains need source type classification (empirical, testimony, inference) to weight confidence updates meaningfully
- Prediction calibration requires minimum 10 resolved predictions for statistically meaningful Brier scores
- Time-travel history (past belief state) is more valuable than real-time mutation logging — users want to understand how their mind changed, not replay individual edits
- Force-directed graph layout is stable with ≤150 nodes before alpha decay tuning becomes necessary

## Actionable

Decay formula and half-life model are reusable for any staleness-aware knowledge system. The SQLite schema (beliefs + evidence + connections + updates) is a clean pattern for local-first epistemic tools.
