---
title: NOAA CO-OPS API
---

# NOAA CO-OPS API

NOAA Center for Operational Oceanographic Products and Services tide prediction API. Provides free US-only tide station lookup and 7-day tide predictions. Used in TideEngine for domestic tide data.

## Usage Context

- Station lookup by lat/lon within 50km radius (Haversine distance)
- 7-day tide predictions: high/low times and heights
- JSON response parsing with URLSession
- 24-hour client-side cache to reduce API calls
- Free, no API key required for US stations
