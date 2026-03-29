---
title: D3-Geo World Map with Choropleth
---

# D3-Geo World Map with Choropleth

Interactive SVG world map using D3-geo and TopoJSON with choropleth coloring and relationship connection lines, rendered client-side in React with Next.js static export.

## Demonstrated Capabilities

- geoNaturalEarth1 projection with TopoJSON world-110m for country path rendering
- ChoroplethLayer: d3.scaleDiverging color scale mapped to p50 simulation values at scrub position
- ConnectionLayer: SVG lines with stroke-width derived from tradeVolume/allianceStrength deltas
- TimelineScrubber: month 0–60 range input with 16ms debounce on map re-render
- Next.js App Router compatibility: D3 code behind `'use client'` guards and dynamic imports
- `output: 'export'` static build — no server, fully self-hostable
- SVG zoom/pan with d3-zoom, reset on country reselection
