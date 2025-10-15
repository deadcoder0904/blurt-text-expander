# Blurt Text Expander

Cross‑browser MV3 extension with Bun, TypeScript, Tailwind v4, Biome, and automated icon generation.

## Features

- Cross‑platform (Chrome + Firefox via `webextension-polyfill`)
- TypeScript‑first architecture under `src/`
- Tailwind CSS v4 with `@theme` syntax
- Light/Dark theme toggle with sun/moon icon
- One‑command dev (`bun run dev`) and production build
- Automated icon generation from a single source PNG
- Bun test for utilities

## Development

Requirements:

- Bun >= 1.1
- zip CLI for the `zip` script (optional)

Install deps (if needed), then run:

- Dev (chrome target): `bun run dev`
- Build (chrome target): `bun run build`

Environment variables:

- `BROWSER=chrome|firefox` to choose manifest target (default: `chrome`)

Load the `dist/` folder as an unpacked extension.

## Scripts

- `dev` — generate icons (if missing), build, and watch
- `build` — production build with minified CSS/JS
- `icons` — generate icons from SVG/PNG:
  - Preferred: `src/assets/icon.svg`
  - Also supported: `src/assets/icon.png`, `src/assets/icon-source.svg`,
    `src/assets/icon-source.png`
  - Or pass a path: `bun run icons -- --src=path/to/icon.svg`
- `icons:check` — check if all icon sizes exist
  - SVG supported: place `src/assets/icon.svg` (preferred) or pass `--src=path/to/icon.svg`. PNG
    fallback also supported.
- `test` — run unit tests (Bun)
- `lint` / `format` — Biome lint and format
- `zip` — create an archive for the current target in `dist/` (e.g., `blurt-text-expander-chrome.zip`)

## Structure

- `src/background/service-worker.ts` — background logic
- `src/popup/` — popup HTML/TS
  - Theme toggle stored in `storage.local` as `theme` (`dark` default)
- `src/pages/blocked.html` — (if present) example page
- `src/styles/` — Tailwind v4 entry CSS
- `src/shared/` — types, constants, utils
- `scripts/` — build, icon, zip scripts
- `manifests/` — per‑browser manifest templates

## Notes

- Replace `src/assets/icon-source.png` with a high‑res square PNG (>= 512x512).
- Or add `src/assets/icon.svg` (or `icon-source.svg`) and the icon pipeline will rasterize to PNG
  sizes (16/32/48/128/256) for Chrome/Firefox. SVG files aren’t reliably supported directly in
  manifests across browsers, so we ship PNGs for compatibility.
- Tailwind v4 is CSS‑first; see `src/styles/*` for theme tokens.
- The background and popup use `webextension-polyfill` to work on Firefox and Chrome.
