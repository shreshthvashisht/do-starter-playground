# Who is London's network built for? A PTAL story for the Data Observatory

Entry for the Imperial Data for Humanity internships. A wall-scale story built on the DO starter playground, using Transport for London's PTAL 2023 grid (Public Transport Access Level, 159,451 squares of 100 m across Greater London).

## What it shows

- **Total access layer:** each square coloured by its PTAL band (0 to 6b). 47.0% of squares are PTAL 0 to 1b (little or no service within walking distance); 5.9% are PTAL 6a to 6b (excellent access).
- **Bus-only layer:** the same squares scored on the bus component alone, banded with the PTAL band edges. 51.4% of squares with any service rely on buses alone (66,613 of 129,507). About 1% reach PTAL 6a on buses alone.
- **Controls:** `/control` switches between the two layers, jumps to London and zooms the wall. The wall fades between layers over 600 ms.

## Run it

```bash
pnpm install
pnpm exec vp run dev
```

Then open `http://localhost:5780/` (mini-wall preview), `/control` (operator panel) or `/screen?c=1&r=1` (one wall tile). The test wall is 3 x 2 tiles of 1920 x 1080; the real DO is 16 x 4.

## Data and how the files were built

Source: TfL GIS Open Data Hub, "PTAL 2023 Grid 100mx100m Data" (GeoJSON download, about 80 MB, not committed).

1. Put the download at `data/ptal2023.geojson`.
2. `python scripts/shrink_ptal.py` writes `data/ptal_compact.json` (one row per square: lon, lat, band, AI, bus score).
3. `python scripts/render_ptal_image.py` writes `apps/website/public/ptal_ai.png`.
4. `python scripts/render_bus_image.py` writes `apps/website/public/ptal_bus.png`.

`notebooks/explore_ptal.ipynb` holds the checks: row counts match the source (159,451), no nulls or duplicate squares, AI equals the sum of the four mode scores, and the band counts match TfL's published summary.

## Caveats

- Figures are shares of 100 m grid squares (area), not people. Areas are approximate at 1 hectare per square.
- PTAL measures public transport supply near a location, not journey quality or affordability.
- The bus-only bands are my own construction, using the PTAL band edges on the bus score. This is not a TfL product.
- The `maxTextureDimension2D` console error also appears in the unmodified starter.

## Credits

Data: Transport for London. © Crown copyright and database rights 2026 Ordnance Survey AC0000806239. Data is subject to TfL's terms of use.

---

(original starter README follows)

# DO App Kit

A starter for creating DO custom applications.

This starter repo is built with Vite+.

## Runtime Context Note (Top-Level vs Iframe)

Data Observatory deployments may render an app either:

- as a top-level document, or
- inside one or more iframes (for multi-screen orchestration/simulation).

This matters for graphics-heavy features: iframe-based deployments can increase pressure on
browser/GPU context limits (especially with WebGL). For that reason, this example includes
runtime-aware rendering decisions and fallback strategies so behavior remains stable in both modes.

## Stack Used In This Example

The example app in `apps/website` focuses on three package groups:

- `@tanstack/react-router`: file-based routing and route-level app structure (`/`, `/control`, `/screen`, `/bus`).
- `@tanstack/pacer`: throttling of high-frequency control events before broadcast (for example slider updates).
- Mapping stack:
  `maplibre-gl`, `@vis.gl/react-maplibre`, `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/react`.
  These are used to render the map, draw animated paths/markers, and support both richer and iframe-safe rendering paths. We strongly recommend the use of Deck.GL with MapLibre as the DO natively supports them.
- `vite-plus` (`vp`): monorepo task runner/repo manager used for project commands (`vp run dev`, `vp run build -r`, etc.).

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run test -r
```

- Build the monorepo:

```bash
vp run build -r
```

- Run the development server:

```bash
vp run dev
```
