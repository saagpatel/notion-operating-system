---
title: "GPU Particle Force Field Simulation on iOS Metal"
---

# GPU Particle Force Field Simulation on iOS Metal

## Summary

Research into high-performance real-time particle simulation on iOS/iPadOS using Metal compute pipelines, field-based force models, and non-realtime export strategies.

## Key Findings

- Metal compute shaders can sustain 100K+ particles at 60fps on A14+ chips with triple buffering and proper buffer synchronization
- Spatial grid hash (not O(n²) neighbor scan) is required for Flocking behavior — compute overhead is dominated by neighborhood queries, not force evaluation
- Field nodes should be uploaded to GPU buffer each frame even without movement — GPU-resident copy avoids buffer synchronization for the common case
- OffscreenRenderer (offline, non-realtime) is the only viable export strategy: recording live frames creates timing races with the render loop and memory spikes
- 2× PNG export is safe on all devices; video at 1× iPhone / 2× iPad avoids OOM — 4× is unsafe on 3GB RAM devices
- Curated palettes (8 fixed sets) produce dramatically better art than free color pickers — user-chosen palettes with 100K particles produce muddied outputs due to color averaging in trail accumulation
- UIKit gesture layer (UIGestureRecognizer) must own all canvas input — SwiftUI gestures and MTKView fight for touch priority and lose

## Actionable

Triple-buffered MTKView + OffscreenRenderer pattern is reusable for any iOS Metal rendering app that needs export. Spatial grid hash pattern in Metal compute is portable to any neighbor-query particle system.
