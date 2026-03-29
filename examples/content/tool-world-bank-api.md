---
title: World Bank Open Data API
---

# World Bank Open Data API

Free, no-authentication REST API for macroeconomic indicators by country. Used for optional baseline data refresh in geopolitical simulation tools.

## Key Details

- Base URL: `https://api.worldbank.org/v2/`
- No API key required — fully open
- Indicators used: GDP (NY.GDP.MKTP.CD), GDP growth (NY.GDP.MKTP.KD.ZG), trade % GDP (NE.TRD.GNFS.ZS), military expenditure (MS.MIL.XPND.GD.ZS), inflation (FP.CPI.TOTL.ZG), unemployment (SL.UEM.TOTL.ZS), Gini (SI.POV.GINI)
- Response format: JSON with nested `[meta, data]` array — need `data[1]` for actual values
- Pagination: `per_page=1&mrv=1` returns most recent single value per indicator
- Rate limits: generous for low-frequency use (~60 req/min per IP for hobby projects)
