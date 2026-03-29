---
title: Ollama Local LLM Integration
---

# Ollama Local LLM Integration

Streaming integration with Ollama's local LLM inference API. Covers NDJSON stream parsing, chain-of-thought token extraction, model selection, and async cancellation patterns in Rust.

## Demonstrated Capabilities

- Ollama REST API integration (`/api/generate` with `stream: true`)
- NDJSON streaming response parsing in Rust via reqwest
- Chain-of-thought `<think>` token block extraction with heuristic regex parser
- Async stream cancellation via CancellationToken
- Multi-model support: DeepSeek-R1, Qwen3, configurable model selection
- Temperature and generation parameter control
- Error handling for connection failures and model availability
