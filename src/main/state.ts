// Tiny persisted app config (registered project folders + window bounds).

import * as fs from "node:fs";
import * as path from "node:path";
import type { Rect } from "../lib/window-bounds";

interface AppConfig {
  projects: string[];
  windowBounds?: Rect;
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, "app-config.json");
}

function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (["x", "y", "width", "height"] as const).every((k) => typeof rec[k] === "number" && Number.isFinite(rec[k]));
}

export function loadAppConfig(userDataDir: string): AppConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(userDataDir), "utf8")) as Partial<AppConfig>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects.map(String) : [],
      windowBounds: isRect(parsed.windowBounds) ? parsed.windowBounds : undefined,
    };
  } catch {
    return { projects: [] };
  }
}

export function saveAppConfig(userDataDir: string, config: AppConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(config, null, 2), "utf8");
}
