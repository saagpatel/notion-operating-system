---
title: Ollama
---

# Ollama

Local LLM inference server for running open-weight models (DeepSeek-R1, Qwen3, Phi-3, Llama) on-device. Provides a REST API for streaming generation, model management, and embedding. Used as the inference backend for thought-trails' real-time reasoning visualization.

## Usage Context

- Streaming `/api/generate` endpoint with NDJSON response format
- Model pull and management via CLI
- Local-first: no API keys, no cloud dependency, runs on localhost:11434
- Chain-of-thought models expose reasoning tokens within `<think>` blocks
