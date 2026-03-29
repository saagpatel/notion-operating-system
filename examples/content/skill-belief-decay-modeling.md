---
title: Belief Graph & Confidence Decay Modeling
---

# Belief Graph & Confidence Decay Modeling

Application domain design for representing personal epistemics as a structured graph: confidence scoring, evidence chains, decay curves, and prediction calibration.

## Demonstrated Capabilities

- Confidence score (0–100) per belief node with configurable half-life decay
- Exponential decay: `0.15 + 0.85 * e^(-ln(2)/half_life * days)` — floors at 0.15, nodes dim but never disappear
- Evidence chain per belief: structured citations with source type, date, and weight
- Prediction tracking: attach predictions to beliefs, score outcomes, track calibration over time
- BeliefUpdate log: time-stamped history of confidence changes with reason tagging
- Domain tagging with filter chips for categorical organization
- Time-travel history: scrub backward through belief state at any past date
- SQLite schema: beliefs, evidence, connections, updates tables with FK enforcement
