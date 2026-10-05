# Improvement Task Specs

The list of improvement tasks for agent-cockpit. Each spec is written so that **an AI agent seeing this repository for the first time can complete the implementation on its own**.

**Always read [00-conventions.md](00-conventions.md) before starting.** The absolute rules shared by all tasks (lib purity, 100% coverage gate, surgical edits, security invariants) are collected there, and each spec assumes them.

## List (recommended order)

| # | Task | Size | Value | Depends on |
|---|---|---|---|---|
| [01](01-command-palette.md) | Cmd+K command palette (cross-entity search) | half a day | ★★★ | none |
| [02](02-mcpjson-toggle.md) | Enable/disable toggle for .mcp.json servers | small | ★★★ | none |
| [03](03-permissions-editor.md) | Dedicated permissions editor | small | ★★ | none |
| [04](04-conflict-draft.md) | Keep and re-apply the draft on conflict | small | ★★ | none |
| [05](05-skill-sync.md) | Compare and sync Skills between Claude and Cursor | 1 day | ★★★ | none |
| [06](06-mcp-healthcheck.md) | Health check for MCP servers | 1 day | ★★★ | none |
| [07](07-new-agents.md) | Support for other agents (Gemini CLI, etc.) | 1 day each | ★ | none |
| [08](08-bundle-split.md) | Split the renderer bundle | small | ★ | none |
| [09](09-light-theme.md) | Light theme support | small | ★ | none |
| [10](10-window-state.md) | Persist window state and sections | small | ★ | none |
| [11](11-scan-errors-panel.md) | Scan error detail panel | small | ★ | none |
| [12](12-update-check.md) | Manual update check | small | ★ | none |

There are no dependencies, so you may implement any single task. When implementing several at once, note that 01/05/06 touch the store and IPC and are prone to conflicts. Finish them one at a time (tests green + commit).

## Definition of done (all tasks)

1. `npm run typecheck` green (both node and web)
2. `npm run coverage` green. **src/lib must stay at 100/100/100/100** (CI fails if even one branch is missed)
3. `npm run build` succeeds
4. `npm audit` stays at 0 vulnerabilities
5. Carry out each spec's "Verification" section and report the results
6. Satisfy every item in each spec's "Completion criteria"
