---
title: iOS Export Pipeline (AVAssetWriter + PHPhotoLibrary)
---

# iOS Export Pipeline (AVAssetWriter + PHPhotoLibrary)

Non-realtime video and image export on iOS using AVAssetWriter for MP4 and PHPhotoLibrary for camera roll delivery.

## Demonstrated Capabilities

- AVAssetWriter pipeline: render N frames offline to CMSampleBuffer, finalize to MP4 in Documents/
- Offline render strategy: pause live simulation, render frames sequentially to offscreen MTLTexture — prevents memory spikes from capturing live frames
- Adaptive export resolution: 1× iPhone / 2× iPad for PNG; same for video to avoid OOM on iPhone
- PHPhotoLibrary.performChanges for camera roll save with permission handling
- UIActivityViewController for share sheet delivery (AirDrop, Files, Messages)
- Field nodes excluded from all export output — nodes are editorial scaffolding only
- Export progress tracking with cancellation support
