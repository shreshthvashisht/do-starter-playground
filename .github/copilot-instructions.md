This app targets the Data Observatory wall (README and best-practices docs apply).

- Wall text must be at least 20% of screen height, sized in vh/vw/clamp, never fixed px.
- No flashing, no fast motion. Transitions are slow fades.
- No Math.random() or Date.now() in render code (hydration).
- Treat loaded data as untrusted: validate shape, soft-fail with retry.
- /screen may run inside iframes: keep WebGL light, keep the MapLibre fallback working.
- Make one change at a time and report exactly what was run and what was seen.
- Never commit data/ptal2023.geojson (over 80 MB).
