---
title: ARKit LiDAR Room Scanning
---

# ARKit LiDAR Room Scanning

Native iOS augmented reality development using ARKit 6 with LiDAR sensor for room geometry extraction. Covers scene reconstruction, plane anchor detection, mesh processing, and live position tracking on iPhone Pro / iPad Pro.

## Demonstrated Capabilities

- ARKit session lifecycle management (ARWorldTrackingConfiguration)
- LiDAR plane anchor detection with floor/wall/ceiling classification
- Scene reconstruction mesh processing for bounding box extraction
- Real-time device position tracking in world coordinates
- ARSessionDelegate callbacks with thread-safe main-thread dispatch
- SCNHitTest for 3D surface interaction
- Outdoor/open space detection for graceful fallback
