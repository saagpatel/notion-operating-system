---
title: AVAudioEngine Real-Time Synthesis
---

# AVAudioEngine Real-Time Synthesis

Real-time audio synthesis using Apple's AVAudioEngine framework. Covers multi-oscillator audio graphs, render callbacks via AVAudioSourceNode, timbre processing, audio recording, and performance optimization for mobile devices.

## Demonstrated Capabilities

- 16-oscillator bank via AVAudioSourceNode with render callbacks
- Audio graph construction: source nodes → mixer → timbre processor → output
- Drone timbre (harmonics + LFO modulation) and Ambient timbre (granular via AVAudioUnitTimePitch)
- Position-responsive amplitude control for spatial audio effect
- Audio recording via installTap on mixer node → AVAudioFile (WAV)
- Double-configure crash guard for AVAudioEngine lifecycle safety
- Performance tuning for real-time synthesis on A15-A17 chipsets
