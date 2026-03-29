---
title: Metal GPU Particle Simulation (iOS)
---

# Metal GPU Particle Simulation (iOS)

High-performance real-time particle simulation on iOS/iPadOS using Metal compute and render pipelines with field-driven force evaluation and GPU-resident particle state.

## Demonstrated Capabilities

- Metal compute kernel (ParticleCompute.metal): force evaluation from N field nodes + velocity integration per particle
- Metal render kernel (ParticleRender.metal): point sprite rendering with trail accumulation via alpha blending
- Triple-buffered MTKView render loop — CPU and GPU work pipelined for smooth 60fps
- FieldManager uploads field node array to GPU buffer each frame — zero CPU-GPU synchronization overhead
- OffscreenRenderer: non-realtime export path renders to MTLTexture, avoids racing live simulation
- 4 field node types: attractor, repeller, vortex, turbulence emitter
- 4 particle behaviors: Flocking (spatial grid hash), Diffusion, Crystallization, Orbital
- Adaptive quality scaling to maintain target framerate across device classes
- Metal struct alignment: all shared Swift/Metal structs padded to 32-byte multiples
