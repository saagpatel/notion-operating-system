---
title: "Multi-Criteria Decision Scoring Algorithms"
---

# Multi-Criteria Decision Scoring Algorithms

## Summary

Research into weighted scoring models, sensitivity analysis approaches, and rank stability detection for multi-criteria decision-making tools.

## Key Findings

- Weighted sum model (`score * weight / maxPossible * 100`) provides intuitive normalized scores that users can reason about
- Sensitivity analysis via live weight manipulation reveals rank instability — small weight changes can flip rankings, which users need to see immediately
- Rank-change detection requires comparing full orderings (not just top-1) to catch meaningful shifts
- Radar charts are effective for up to 6 options with 4-8 criteria — beyond that, the visualization loses clarity
- Template-based criteria reuse dramatically reduces setup friction for recurring decision types
- In-memory analysis (not persisting every slider move) keeps the UX responsive and avoids DB write amplification

## Actionable

Scoring engine design validated through TradeOffAtlas implementation. Pure function architecture (`computeWeightedScore`, `rankOptions`, `detectRankChanges`) is portable to other scoring contexts.
