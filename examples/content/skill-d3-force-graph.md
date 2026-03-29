---
title: D3 Force-Directed Graph (Direct DOM)
---

# D3 Force-Directed Graph (Direct DOM)

Real-time force simulation with D3.js v7 using direct SVG DOM ownership via useRef and tick callbacks, bypassing React re-render cycle for performance at scale.

## Demonstrated Capabilities

- D3 force simulation with custom link/charge/center forces, configurable alpha decay
- Direct SVG DOM manipulation via useRef + requestAnimationFrame tick callbacks — React never touches node x/y positions
- Node decay animation: exponential brightness formula `0.15 + 0.85 * e^(-ln(2)/half_life * days)` for staleness visualization
- Minimap: canvas-based 200×120px overview synchronized with main simulation
- Freeze/resume simulation for panel interactions without layout disruption
- Connection rendering with directional arrows and variable stroke weight
- Right-click context menu for edge creation with active force simulation
