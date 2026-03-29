---
title: SceneKit 3D Globe Rendering
---

# SceneKit 3D Globe Rendering

Real-time 3D globe visualization using SceneKit with sphere geometry, dynamic lighting, camera animation, and hit-test interaction. Covers continental outline overlays, rotation animation, and integration with Metal compute textures.

## Demonstrated Capabilities

- SCNSphere geometry (128 segments) with real-time material updates
- Camera transform animation (0.4s zoom to coastline point)
- SCN hit-test for 3D surface point → lat/lon conversion
- Continental outline rendering from simplified GeoJSON vertices
- Earth rotation animation synced to real solar day (86400s cycle)
- Lighting model configuration for dark aesthetic globe
