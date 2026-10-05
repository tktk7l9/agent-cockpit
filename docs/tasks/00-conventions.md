# 00. Common Conventions (required reading for all tasks)

This file is the premise of every spec. An implementation that breaks the invariants written here is a **failure**, even if the feature works.

## 1. Repository structure and responsibilities

```
src/
├── lib/        # Pure functions only. No electron, node:fs, or side effects. Subject to the 100% coverage gate
│   ├── model/types.ts   # Domain model (7 Entity kinds × agent × scope) and FileEdit
│   ├── paths.ts         # layout(home) → all settings paths. home is always injected as an argument (never hard-code it)
│   ├── json/jsonc-edit.ts   # Surgical JSON editing with jsonc-parser
│   ├── toml/toml-edit.ts    # Surgical TOML editing using toml-eslint-parser AST ranges
│   ├── markdown/frontmatter.ts
│   ├── agents/{claude,codex,cursor}.ts + mcp-common.ts  # Readers for each tool
│   ├── inventory.ts     # TaggedSnapshot[] → Entity[] (the only entry point on the read side)
│   └── mutations.ts     # Mutation union + planMutation() (the only entry point on the write side)
├── shared/ipc.ts   # CHANNELS constants + CockpitApi type (the renderer↔main contract)
├── main/           # Thin I/O adapters. index.ts (IPC registration/window) / fs-gateway.ts / scan.ts / state.ts
├── preload/index.ts # Exposes only window.cockpit via contextBridge
└── renderer/src/   # React 19 + zustand (store.ts) + CodeMirror 6. views/ + components/
```

Data flow:
- **Read**: main `runScan(home, manualProjects)` → collects from fs as directed by lib `scanSpec` → lib `buildInventory` → `ScanResultPayload` to the renderer
- **Write**: the renderer builds a `Mutation` → `window.cockpit.preview(m)` → main runs lib `planMutation` on a fresh snapshot → the diff is shown in DiffModal → `apply(m, baseHashes)` → sha256 check → backup → atomic write

## 2. Absolute invariants (breaking any of them is a failure)

1. **lib purity**: do not add imports of `electron` / `node:fs` / `node:child_process` etc. to `src/lib/**`. If you feel like putting decision logic in main, split the pure part out into lib (example: `isPathAllowed` is in lib, `realpathSync` is in main).
2. **100% gate**: the thresholds in `vitest.config.ts` are 100/100/100/100. **Lowering them or adding excludes is forbidden.** If you wrote an unreachable defensive branch, do not force a test through it; simplify the code instead (example: yaml output always ends with a newline → do not write a ternary).
3. **No whole-file re-serialization**: never write a settings file with `JSON.stringify(whole)` or a full TOML re-emit. For JSON use `setJsonValue`/`removeJsonKey` (only the target subtree changes; everything else stays byte-identical), for TOML use `upsertTableBlock`/`setKeyInTable`/`removeTables` (comments survive). If a new write pattern is needed, add a function to jsonc-edit / toml-edit and add an invariant test that a **no-op mutation is byte-identical**.
4. **Writes only through planMutation**: main must not write settings files directly with `fs.writeFileSync`. A write for a new feature must add an op to the `Mutation` union and extend `planMutation` + `mutationReadPaths`.
5. **Do not weaken the denylist**: `~/.codex/auth.json`, `.env*`, `*credential*`, `*secret*`, `*token*` (`isPathDenied` @ src/lib/paths.ts). Loosening the allowlist (`isPathAllowed`) is also forbidden.
6. **Electron security baseline**: contextIsolation:true / sandbox:true / nodeIntegration:false / all navigation denied / no remote content loading / the preload exposes exactly one typed API (never expose a raw ipcRenderer). CSP is injected only into production builds by the inject-csp plugin in electron.vite.config.ts (dev does not inject it because react-refresh needs an inline script. Do not change this structure).
7. **Fixtures are synthetic data only**: do not copy settings values, real API keys, or PII from a real machine into tests or documentation.
8. **Secret display**: env/header values are masked by default in the UI and masked with `maskDiff` in diffs too. Treat them the same way when a new UI displays these values.

## 3. Implementation patterns (write it exactly this way)

### Steps to add a new Mutation op
1. `src/lib/mutations.ts`: add the op to the `Mutation` union → add a pure planner function to the `planMutation` switch → always add it to `mutationReadPaths` too (the fresh-read targets at apply time)
2. Add validation to `src/lib/validate.ts` and throw at the top of the planner
3. In `tests/mutations.test.ts` (or a new test file), add: happy path / error path (throw) / mutationReadPaths / **bytes outside the target are unchanged** tests
4. From the renderer, just call `useStore().requestPreview(mutation)`. DiffModal, conflict handling, and backups come along automatically

### Steps to add a new IPC channel
1. `src/shared/ipc.ts`: add `"cockpit:<name>"` to `CHANNELS` and add the method type to `CockpitApi`
2. `src/preload/index.ts`: add one `ipcRenderer.invoke` wrapper line to the `api` object
3. `src/main/index.ts` `registerIpc()`: add `ipcMain.handle(CHANNELS.<name>, ...)`. **A handler that receives a file path must always go through `checkPath()`**
4. renderer: call it with `window.cockpit.<name>()` (the type takes effect automatically via preload/api.d.ts)

### Steps to add a new entity kind/field
1. Add the type to `src/lib/model/types.ts` → add the scan target to `scanSpec` in `src/lib/paths.ts` (extend `SnapshotTag`) → add a case to the switch in `src/lib/inventory.ts`
2. `src/main/scan.ts` collects mechanically by tag kind (files/skillDirs/mdFiles/ruleFiles), so no change is needed if an existing type can express it
3. Add happy-path + error-path + null (absent) cases to `tests/inventory.test.ts`

### UI conventions
- Reuse the existing classes in `src/renderer/src/styles.css`: `.field` `.btn .btn-primary .btn-small .btn-danger .btn-icon` `.pane-head` `.banner .banner-warn` `.pill .pill-add .pill-del` `.tag` `.badge-{claude,codex,cursor,shared}` `.modal-backdrop .modal` `.table` `.switch` `.toast`. Always go through CSS variables for colors (`--accent` `--claude` `--codex` `--cursor`, etc.)
- Use `McpView.tsx` / `MarkdownEntityView.tsx` as the template for list + editor two-pane layouts, and `PluginsView.tsx` for table layouts
- Use `AgentBadge` / `ScopeTag` from `components/ui.tsx` for agent/scope display
- The label of a save button is `Save…` (the … signals that a diff preview comes in between). Destructive operations are `Delete…`
- Component state is `useState` for edit drafts; app state lives in `store.ts` (zustand). Call `setDirty(true)` when editing starts

## 4. Commands and completion checks

```bash
npm run dev          # HMR development (an Electron window opens)
npm run typecheck    # Runs tsc --noEmit for the node/web projects
npm run coverage     # vitest + v8. src/lib must be 100/100/100/100
npm run build        # electron-vite build
npm audit            # Keep at 0 findings
npx electron .       # Launch the production build (after build)
```

Commit convention: at least 1 commit per task; the message is an English summary + free-form body. Set the `Co-Authored-By:` line to match the model that implemented it. CI (.github/workflows/ci.yml) runs on push: typecheck → coverage → build → audit (ubuntu) + dmg (macos-14, main only).

## 5. Known pitfalls (actually hit in a previous session)

| Pitfall | Fix |
|---|---|
| electron-vite 5 does not support vite 8 | vite is pinned to ^7. **Do not upgrade vite to 8**. Keep @vitejs/plugin-react on the ^4.7 line too |
| A sandboxed preload cannot be ESM | The preload is a CJS build (format: "cjs" is set in electron.vite.config.ts). Do not change it |
| chokidar v5 does not support globs | Watch only the explicit paths returned by `watchPaths()`. Do not pass glob patterns |
| CSP conflicts with dev mode | Inject CSP only in production builds (inject-csp plugin). Do not write a CSP meta directly in index.html |
| macOS `/var` is a symlink to `/private/var` | Path comparison is handled by `resolveAndCheck` (fs-gateway.ts), which compares realpaths on both sides. Do the same when writing new path validation |
| Backup timestamp collisions | Consecutive writes within the same ms are avoided with `-1` `-2` suffixes (writeBackup) |
| `String(yamlDocument)` always ends with a newline | A defensive branch for the trailing newline dies at the 100% gate. Do not write it |
| jsonc-parser `modify` auto-creates intermediate keys | Deep paths like `["projects", path, "mcpServers", name]` go through in one call. Do not create parents manually |
| Empty files (a 0-byte ~/.cursor/mcp.json really exists) | JSON readers treat `text.trim()===""` as `{}`. New readers must do the same |
| Entity union narrowing | Narrowing with `e.kind === "skill"` sometimes does not work through an array `find`. Use a type guard function or `as` to pass typecheck |

## 6. Do not do (out of scope)

- Keep added dependencies to a minimum. If you add one, confirm `npm audit` stays at 0 and state the purpose in the commit message. Do not introduce electron-store / Monaco / lodash-type libraries
- Do not add automatic telemetry or automatic network communication (the portal advertises "zero network communication at runtime". Task 12 alone is an exception: it allows communication initiated by a user action and also updates the portal entry)
- Do not implement writes that touch **any key other than** `mcpServers` / `projects.*.mcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers` in `~/.claude.json`
- Do not do release work (version bump / gh release / portal update) unless the spec says so explicitly
