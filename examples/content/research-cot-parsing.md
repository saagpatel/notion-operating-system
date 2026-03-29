---
title: "Chain-of-Thought Token Parsing Patterns"
---

# Chain-of-Thought Token Parsing Patterns

## Summary

Investigation into how reasoning models (DeepSeek-R1, Qwen3) structure their chain-of-thought output within `<think>` token blocks. Findings drove the parser architecture for thought-trails.

## Key Findings

- CoT token structure is **not standardized** across models — DeepSeek-R1, Qwen3, and Phi-3 each format reasoning differently
- Heuristic regex parsing outperforms XML parsing for real-world CoT output due to malformed tags and inconsistent nesting
- Reasoning patterns cluster into 4 node types: claims (assertions), evidence (supporting facts), backtracks (corrections), and conclusions (final answers)
- Stream chunking at NDJSON boundaries is reliable across Ollama models — partial JSON is rare but must be handled
- Node count beyond ~200 degrades graph readability significantly regardless of layout algorithm

## Actionable

These patterns directly informed the thought-trails CoT parser design. Reusable for any future LLM reasoning visualization or analysis tool.
