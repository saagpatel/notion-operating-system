---
title: "Gravitational Tidal Forcing Visualization Techniques"
---

# Gravitational Tidal Forcing Visualization Techniques

## Summary

Research into making invisible gravitational tidal physics visible through real-time 3D rendering. Covers VSOP87 ephemeris implementation, two-body tidal force computation, and heightfield-to-texture rendering approaches.

## Key Findings

- VSOP87 truncated series provides Moon accuracy within ±0.5° and Sun within ±0.2° — sufficient for tidal visualization, validated against JPL Horizons reference values
- Two-body tidal forcing (Moon + Sun) captures 95%+ of real tidal variation — higher-order harmonics not needed for visualization
- Normalized heightfield grid (64x32, [-1.0, 1.0]) is the right abstraction between physics simulation and GPU rendering
- Metal compute shader at 512x256 resolution achieves 60fps on iPhone 15 — the bottleneck is SceneKit material updates, not GPU compute
- Luminous dark aesthetic (indigo/teal base → white-hot peaks) is dramatically more effective than realistic blue ocean coloring for showing gravitational displacement
- Continental outlines from simplified GeoJSON (~500 vertices) are sufficient for coastline recognition without overwhelming the visual

## Actionable

Ephemeris + tidal force + Metal shader pipeline is portable to any gravitational visualization (e.g., Jupiter moon system, binary star tides). Pure-Swift VSOP87 implementation is reusable standalone.
