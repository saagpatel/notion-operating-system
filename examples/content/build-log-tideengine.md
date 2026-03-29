---
title: "TideEngine: v1.0 Complete — Real-Time Gravitational Tide Visualization"
---

# Build Log Entry

## What Was Planned

Build a native iPhone app (SwiftUI + SceneKit + Metal, iOS 17+) that renders a real-time gravitational simulation of lunar and solar tidal forcing on a stylized dark globe. Four phases: foundation + Metal shader, globe animation + tap-to-coastline, NOAA integration + local tide view, widget + StoreKit IAP + international.

## What Shipped

**Phase 0 — Foundation + Metal Shader Proof:**
- Pure-Swift VSOP87 truncated ephemeris for Moon and Sun ecliptic coordinates (validated against JPL Horizons within ±0.5°/±0.2°)
- Two-body tidal force calculation with normalized heightfield (64x32 grid)
- Metal compute shader (`tidalHeightField`) rendering 512x256 texture with luminous dark aesthetic (indigo/teal → white-hot peaks)

**Phase 1 — Globe Animation + Tap-to-Coastline:**
- SceneKit globe (128-segment sphere) with real-time displacement texture at 60fps
- Earth rotation at 1 cycle/86400s with tidal bulges tracking lunar motion
- Continental outlines from simplified GeoJSON (~500 vertices)
- SCN hit-test → CoastlineResolver → 0.4s camera zoom → hard cut to LocalTideView

**Phase 2 — NOAA Integration + Local Tide View:**
- NOAA CO-OPS API: station lookup within 50km by Haversine distance, 7-day predictions
- 24-hour UserDefaults-backed cache
- LocalTideView: station name, data source badge, 7-day Swift Charts tide curve, next high/low countdown
- CoreLocation auto-load of nearest station on first launch

**Phase 3 — Widget + StoreKit + International:**
- WidgetKit: small + medium home screen widgets with gravitational pull gauge and next tide time
- 48-entry 24-hour timeline (30-min intervals) via shared App Group UserDefaults
- StoreKit 2 one-time IAP (`com.tideengine.international`) with dynamic price display and restore
- WorldTides API v3 integration behind IAP paywall; API key stored in iOS Keychain
- PaywallView triggered when tapping non-US coastline without unlock

## Key Decisions

- Zero third-party SPM packages — all Apple frameworks, reduces attack surface
- Pure-Swift VSOP87 ephemeris over external API — fully offline, validatable against JPL reference
- Metal compute shader for heightfield — GPU-efficient 60fps updates, luminous dark aesthetic
- Cut transition over morph — reliable, cinematic 0.4s zoom → hard cut to tide detail
- One-time IAP (US free / international paid) — clear value boundary, no subscription friction
- WorldTides API key in Keychain only — impossible to expose in source or UserDefaults
- Strict Swift concurrency (async/await, no DispatchQueue) — compiler-enforced safety

## Next Steps

- Push to GitHub (done)
- Wire into Notion signal pipeline (done)
- App Store submission: metadata, privacy policy, TestFlight beta
- v2 roadmap: historical playback, storm surge overlay, Apple Watch complication
