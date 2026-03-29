---
title: "thought-trails: v1+ Feature Complete — Live CoT Graph Visualization"
---

# Build Log Entry

## What Was Planned

Build a Tauri 2.0 desktop app that visualizes a local LLM's chain-of-thought reasoning as a live, interactive D3.js force-directed graph. Three planned phases: spike + data pipeline, live graph visualization, replay + export.

## What Shipped

**Phase 0 — Spike + Data Pipeline:**
- Tauri 2.0 scaffold with Rust backend and React frontend
- Raw Ollama streaming via reqwest with CancellationToken for async cancellation
- CoT heuristic parser for `<think>` token blocks using regex-based analysis (not XML — validated against real DeepSeek-R1 spike data)
- Reasoning event pipeline from Rust → Tauri emit → React

**Phase 1 — Live D3.js Graph:**
- Force-directed graph with streaming node addition in real time
- 4 node types: claim (blue), evidence (green), backtrack (orange), conclusion (purple)
- Zoom, pan, and interactive node exploration
- D3 force simulation tuned for stability: alphaDecay 0.02, velocityDecay 0.4

**Phase 2 — Replay + Export:**
- Replay mode with adjustable speed
- SVG and JSON export
- Prompt panel with model selector and temperature support

**Beyond Roadmap (advanced features):**
- Session persistence with auto-save and session sidebar
- Graph search with node highlighting
- Node detail panel with ancestry trace
- Collapsible subtrees and tree layout mode
- Dual-stream support with stream ID disambiguation
- Multi-model comparison view
- Frameless window with proper bundle identifier

## Key Decisions

- Heuristic regex parser over XML parser — reasoning token structure varies by model, regex handles edge cases better
- Streaming via Rust reqwest → Tauri emit — keeps heavy I/O off the JS thread
- Graph capped at 200 nodes with graceful warning for readability
- Session-only storage in v1, with export for persistence (no DB overhead)

## Next Steps

- Push to GitHub (done)
- Wire into Notion signal pipeline (done)
- Consider persistent SQLite storage for cross-session graph history
- Test with additional reasoning models (Qwen3, Phi-3)
