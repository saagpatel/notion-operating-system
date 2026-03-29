---
title: "RoomTone: v1.0 Complete — AR Room Acoustic Synthesis"
---

# Build Log Entry

## What Was Planned

Build a native iOS app (SwiftUI + ARKit + AVAudioEngine, iOS 17+) that maps a physical room's geometry using LiDAR and synthesizes a real-time soundscape derived from the room's resonant modes. Four phases: foundation, audio engine + AR integration, visual overlay, polish + App Store readiness.

## What Shipped

**Phase 0 — Foundation:**
- Xcode project with SwiftUI shell, AVAudioSession setup, onboarding flow
- UnsupportedDeviceView for non-LiDAR devices

**Phase 1 — Audio Engine:**
- 16-oscillator synthesis via AVAudioSourceNode bank
- RoomModeCalculator: resonant frequency formula f(n,m,l) for rectangular rooms
- Drone timbre (harmonics + LFO) and Ambient timbre (granular via AVAudioUnitTimePitch)
- Position-responsive amplitude control via ModeAmplitudeController
- Audio recording via installTap → AVAudioFile → share sheet

**Phase 2 — ARKit Integration:**
- LiDAR room scanning via ARKit plane anchor detection
- RoomGeometryProcessor: plane anchors → RoomDimensions extraction
- Live player position tracking for audio modulation
- Auto octave-shift for large rooms (dimensions > 8.5m)

**Phase 3 — Visual Overlay:**
- Translucent wall wireframes via SceneKit AR overlay
- Standing wave animations on detected walls
- Player position indicator (pulse animation)
- Dominant frequency readout + technical overlay toggle

**Phase 4 — Polish + App Store:**
- 3-screen onboarding with TabView
- Scan calibration UX with outdoor/open space detection
- Privacy manifest (PrivacyInfo.xcprivacy)
- Runtime safety audit: thread safety on ARSessionDelegate, Timer lifecycle, double-configure crash guard

## Key Decisions

- Zero third-party SPM packages — pure Apple frameworks only
- LiDAR-only, no non-LiDAR fallback — v1 quality depends on accurate geometry
- 16 max oscillators — A15/A16/A17 performance ceiling; > 20 risks audio artifacts
- Manual amplitude control over AVAudioEnvironmentNode — HRTF fights with drone synthesis
- @Observable (iOS 17 macro) throughout, no legacy ObservableObject
- Plane anchors primary, LiDAR mesh bounding box secondary — anchors are more stable

## Next Steps

- Push to GitHub (done)
- Wire into Notion signal pipeline (done)
- App Store submission with TestFlight external beta feedback
