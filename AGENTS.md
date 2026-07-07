# agent-cockpit

macOS Electron app that manages AI coding agent configuration (MCP servers / skills / subagents / commands / plugins / settings / instructions) across Claude Code, Codex and Cursor.

## Rules

- `src/lib/**` is pure: no `electron`, no `node:fs`, no side effects. It maps `FileSnapshot { path, text }` → `FileEdit { path, newText }`. All file writes funnel through `planMutation` (src/lib/mutations.ts).
- The lib layer is coverage-gated at **100% statements/branches/functions/lines** (`npm run coverage`). If a branch is unreachable, simplify the code instead of excluding it.
- Never re-serialize whole config files. JSON edits go through `src/lib/json/jsonc-edit.ts` (jsonc-parser text edits); TOML edits through `src/lib/toml/toml-edit.ts` (AST-range splices). This preserves unrelated keys, comments and formatting.
- `~/.codex/auth.json`, `.env*`, `*credential*`, `*secret*`, `*token*` are hard-denied (`isPathDenied` in src/lib/paths.ts). Never weaken this.
- Test fixtures must be synthetic — never copy real config values into the repo.
- Renderer security: contextIsolation + sandbox on, single typed preload API (`window.cockpit`), no remote content, CSP injected at build (electron.vite.config.ts).

## Commands

- `npm run dev` — HMR dev app
- `npm run typecheck && npm run coverage && npm run build` — CI equivalent
- `npm run package` — unsigned arm64 dmg/zip in `release/`
- `./scripts/make-icns.sh` — regenerate icon from scripts/generate-icon.swift
