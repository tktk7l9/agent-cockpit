# 02. Enable/Disable Toggle for `.mcp.json` Servers

## Background / Goal

For an MCP server defined in a project's `.mcp.json`, Claude Code's approval state is recorded in `projects[<path>].enabledMcpjsonServers` / `disabledMcpjsonServers` (string arrays) of `~/.claude.json`. Currently the app only **displays** disabled (the `disabled` pill in McpView). Make it toggleable from the GUI.

## Background knowledge (current state of the code)

- Read side: `parseClaudeGlobal` (src/lib/agents/claude.ts) already parses both arrays. `buildInventory` (`case "mcpJson"` in src/lib/inventory.ts) sets `enabled = !gates.disabledMcpjsonServers.includes(name)`
- Entities from `.mcp.json` have `source: { kind: "mcpjson" }`, `scope: { level: "project", projectPath }`, `enabled?: boolean`
- The renderer can build the `~/.claude.json` path as `${data.home}/.claude.json`
- Reference: a projects entry in `~/.claude.json` may have `enableAllProjectMcpServers: boolean` (an allow-all flag). **This task neither reads nor writes it**, but uses it in a UI note (see below)

## Specification

- When a server with `source.kind === "mcpjson"` is selected in McpView, show an enable/disable switch (reuse the `.switch` class) at the top of the editor
- Toggle ON (enable): remove name from `disabledMcpjsonServers` and add name to `enabledMcpjsonServers` (do not add duplicates)
- Toggle OFF (disable): remove from `enabledMcpjsonServers` and add to `disabledMcpjsonServers`
- Both write targets are under `projects[<projectPath>]` in `~/.claude.json`. **Never touch any other key**
- Route it through the normal diff preview (DiffModal) → apply path
- Cursor's mcp.json (`source.kind === "cursor"`) has no such concept, so do not show the switch

## Implementation steps

### 1. lib: add a Mutation

`src/lib/mutations.ts`:

```ts
| { op: "toggleMcpJsonServer"; claudeJsonPath: string; projectPath: string; name: string; enabled: boolean }
```

Planner `planToggleMcpJsonServer(ctx, m)`:
1. `text = ctx.snapshot(m.claudeJsonPath)`. Throw if null (the file always exists once a `.mcp.json` has been approved)
2. Get the current two arrays with `parseClaudeGlobal(text)` (treat a missing project entry as empty arrays; `parseClaudeGlobal` already returns that)
3. Compute the new arrays:
   - enabled=true: `enabledNew = current enabled ∪ {name}` (keep order, append at the end), `disabledNew = current disabled − {name}`
   - enabled=false: the reverse
4. Apply `setJsonValue` twice (`["projects", projectPath, "enabledMcpjsonServers"]` and the same for disabled). **The arrays are keys owned by this feature, so replacing them wholesale is fine** (the unit of surgical editing is the key)
5. If nothing changes (already in the desired state), returning newText as is is fine. DiffModal shows "no textual change" and disables Apply
6. Add `[m.claudeJsonPath]` to `mutationReadPaths`

### 2. inventory: refine the enabled determination

Currently `enabled = !disabled.includes(name)`; change it to also look at the enabled array:

```ts
disabled.includes(name) → false
enabled.includes(name)  → true
in neither              → undefined (unapproved = the state Claude Code asks about at startup)
```

`McpServerEntity.enabled` stays `boolean | undefined`. In McpView's list rows, `enabled === false` → the `disabled` pill (existing), `undefined` → add an `unapproved` `.tag`.

### 3. renderer: extend McpView

Inside `McpEditor`, when `entity.source.kind === "mcpjson"`:

```tsx
<div className="field">
  <label>Claude Code approval</label>
  <switch> … onClick={() => requestPreview({ op: "toggleMcpJsonServer", claudeJsonPath: `${home}/.claude.json`, projectPath, name: entity.name, enabled: !(entity.enabled ?? false) })}
  <p className="muted small">Stored in ~/.claude.json (projects.{path}). If enableAllProjectMcpServers is set, it may take precedence.</p>
</div>
```

Get `projectPath` after narrowing with `entity.scope.level === "project"`. `home` is already received via props.

## Tests

Add to `tests/mutations.test.ts` (or a new describe):
- Enable: removed from disabled and added to enabled. **Decoy keys (other fields of projects, other top-level keys) are byte-identical**
- Disable: the reverse direction
- Enabling a name that was in neither array (pure append to enabled)
- Toggling to the state it is already in (idempotent)
- Enabling for a project path that has no entry in projects at all (confirms that jsonc modify auto-creates intermediate keys)
- Throws when the file is absent
- Add a `mutationReadPaths` case

`tests/inventory.test.ts`: add cases where the name is in the enabled array → true / in neither → undefined (use the existing fixture's `enabledMcpjsonServers: ["a"]`).

## Verification

1. All gates green
2. On a real machine: disable a `.mcp.json` server of any project (e.g. supabase in utility-tracker) → confirm the DiffModal diff is only an addition to `disabledMcpjsonServers` → Apply → start the `claude` CLI in that project and confirm via `/mcp` that it is disabled → revert
3. Compare `~/.claude.json` before and after Apply with `git diff --no-index` (against the backup) and confirm there is zero change other than the two target keys

## Completion criteria

- [ ] All 3 verification points pass (in particular, including the revert on the real machine)
- [ ] lib stays at 100%×4
- [ ] The switch does not appear for servers whose source is cursor
- [ ] `enableAllProjectMcpServers` is not touched (confirm with grep)
