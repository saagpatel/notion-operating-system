---
title: "Room Acoustic Mode Calculation and Spatial Audio"
---

# Room Acoustic Mode Calculation and Spatial Audio

## Summary

Research into acoustic standing waves in rectangular rooms, resonant frequency calculation, and position-dependent amplitude modeling for real-time audio synthesis driven by physical room geometry.

## Key Findings

- Room mode formula f(n,m,l) = (c/2) * sqrt((n/Lx)^2 + (m/Ly)^2 + (l/Lz)^2) accurately predicts resonant frequencies for rectangular rooms
- 16 simultaneous oscillators is the practical ceiling on A15-A17 chips before audio scheduling artifacts appear
- Modes below 40Hz are inaudible on phone speakers — auto octave-shift when room dimensions > 8.5m solves this transparently
- ARKit plane anchors provide more stable room dimension estimates than LiDAR mesh bounding boxes (mesh drifts during scanning)
- Manual amplitude control based on listener position is preferable to AVAudioEnvironmentNode HRTF — HRTF algorithms fight with sustained drone synthesis
- Granular texture via AVAudioUnitTimePitch (rate=0.85, overlap=8) creates convincing ambient timbre without custom DSP, with acceptable ~100ms latency

## Actionable

Room mode calculator and position-responsive amplitude model are reusable for any spatial audio application. The oscillator bank architecture (AVAudioSourceNode per mode) is a clean pattern for real-time synthesis on iOS.
