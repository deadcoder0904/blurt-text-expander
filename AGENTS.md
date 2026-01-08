# Repository Guidelines

## Project Structure & Module Organization

- `src/background/service-worker.ts` — extension background logic.
- `src/content/` — content scripts injected into pages.
- `src/popup/` and `src/options/` — UI HTML/TS and styles under `src/styles/`.
- `src/shared/` — reusable types, constants, utils, storage, and DOM helpers.
- `src/assets/` — source icons (SVG/PNG) for the icon pipeline.
- `manifests/` — per‑browser manifest templates (`manifest.chrome.json`, `manifest.firefox.json`).
- `scripts/` — build, icon generation, and zipping utilities.
- `dist/` — build output loaded as an unpacked extension.
- `tests/` — unit tests (Bun) under `tests/unit`.

## Build, Test, and Development Commands

- `bun run dev` — build for the selected browser and watch.
- `bun run build:chrome` / `bun run build:firefox` / `bun run build:all` — production builds.
- `bun run icons` / `bun run icons:check` — generate or verify icon assets.
- `bun test` — run unit tests; `bun run check` runs types + tests.
- `bun run lint` / `bun run format` — Biome lint/format.
- `bun run zip[:chrome|:firefox|:all]` — package `dist/` into zip(s).
- Useful envs: set `BROWSER=chrome|firefox` when building.

## Coding Style & Naming Conventions

- TypeScript (strict) and ESM. Indentation: 2 spaces, line width: 100 (Biome).
- Filenames: kebab‑case (`service-worker.ts`, `popup.html`); folders lowercase.
- Code: camelCase for variables/functions, PascalCase for types/interfaces, UPPER_SNAKE_CASE for constants.
- Keep shared utilities in `src/shared/`; avoid duplicate logic across targets.

## Testing Guidelines

- Framework: Bun test. Place unit tests in `tests/unit` and name as `*.test.ts`.
- Test isolated utilities (e.g., `src/shared/utils.ts`) and critical popup/background behaviors.
- Run locally with `bun test`; add tests for new utilities and regression fixes.

## Commit & Pull Request Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Keep messages imperative and scoped (e.g., `fix(popup): restore theme toggle`).
- PRs should include: clear description, linked issue (if any), screenshots/GIFs for UI changes, test updates, and notes for manifest impacts.

## Security & Configuration Tips

- Do not commit secrets. Only `BROWSER` is expected via env; prefer `.env` for local overrides.
- Validate manifest changes in both Chrome and Firefox.
- After building, load `dist/` as an unpacked extension to verify permissions and UI.
