# 12. Manual update check

## Background / goal

The app is unsigned, so automatic updates via electron-updater are not available. Add a **manual** check that compares the latest tag on GitHub Releases with the running version and, if newer, directs the user to the release page.

**Privacy constraint**: the portal advertises "zero network communication at runtime". Therefore **do not implement an automatic check**. Network access happens only when the user presses the button. An implementation that breaks this constraint (a check at startup or a periodic check) is a failure.

## Spec

- A small `v0.1.0 — Check for updates` text button at the bottom of the sidebar (above agent-filter)
- On click, main fetches `https://api.github.com/repos/tktk7l9/agent-cockpit/releases/latest` (10-second timeout)
- Results:
  - Newer: banner/toast `New version v0.2.0 available` + an `Open Releases` button (`shell.openExternal("https://github.com/tktk7l9/agent-cockpit/releases/latest")`)
  - Latest: toast `You're up to date (v0.1.0)`
  - Failure (offline, rate limit): toast `Update check failed: <short reason>`
- Version comparison: numeric semver major.minor.patch comparison. For prerelease suffixes, "if the release side has one, ignore it and compare only the core version" is sufficient

## Implementation steps

### 1. lib: version comparison (new `src/lib/version.ts`)

```ts
/** Parse "v1.2.3" / "1.2.3" / "1.2.3-beta.1" into {major,minor,patch}. Returns null if unparseable */
export function parseVersion(tag: string): { major: number; minor: number; patch: number } | null;
/** Returns 1 if a > b, 0 if equal, -1 if a < b. Returns null if either cannot be parsed */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null;
```

### 2. main + IPC

- `CHANNELS.checkUpdate = "cockpit:check-update"` / `CockpitApi.checkUpdate(): Promise<UpdateCheckResult>`:

```ts
export type UpdateCheckResult =
  | { status: "update-available"; current: string; latest: string; url: string }
  | { status: "up-to-date"; current: string }
  | { status: "error"; message: string };
```

- main handler: `app.getVersion()` (electron-builder fills it from the package.json version; when running in dev it may return Electron's own version, so the options are `app.isPackaged ? app.getVersion() : read from package.json` ... to keep it simple, do not rely on `process.env.npm_package_version`, and do not use the build-time constant `import.meta.env` in main — **use `app.getVersion()` as is and, in dev, only verify the result display**; accept this trade-off)
- fetch: Node 22 global fetch + `AbortSignal.timeout(10_000)`. Headers `Accept: application/vnd.github+json` and `User-Agent: agent-cockpit`. Pass the response's `tag_name` to `compareVersions`
- `shell.openExternal` uses a URL fixed to the prefix `https://github.com/tktk7l9/agent-cockpit/` (never open an arbitrary URL from the response — defense against API tampering)

### 3. renderer

A button in the sidebar footer; results use the existing toast (`showToast`). Only for update-available, show a `.banner` at the bottom of the sidebar with an `Open Releases` button (keep `updateInfo` in the store).

### 4. Addition to the release procedure

Do not change `docs/tasks/00-conventions.md`. Instead, add one line to the Development section of README.md: when releasing, bump the version in package.json, then `npm run package` -> `gh release create v<ver> <dmg> <zip>` (the tag matching the version is a prerequisite of this feature).

## Tests

- `tests/version.test.ts` (all branches): parseVersion valid / v prefix / prerelease / invalid string returns null. compareVersions greater, less, equal, and null when unparseable
- The fetch part is not covered by tests (it is in main). It is covered by manual verification

## Verification

1. The full gate suite is green
2. `npx electron .` -> Check for updates -> if the current v0.1.0 is the latest, the up-to-date toast appears
3. Temporarily set the package.json version to 0.0.1 and build -> the update-available banner appears, and Open Releases opens the browser -> restore the version
4. With the network cut off (Wi-Fi off), the error toast appears. The app does not freeze
5. **Check communication timing**: merely launching the app makes no access to the GitHub API at all (confirm with Console.app or `nettop`, or by grepping that there is no fetch call outside the handler)

## Definition of done

- [ ] All 5 verification points pass (especially 5)
- [ ] lib 100%x4 maintained
- [ ] The openExternal URL has a fixed prefix
- [ ] Include in the PR description a proposed update to the portal's "zero network communication" note (wording such as "user-initiated only") (do not change the portal itself)
