// Tiny persisted app config (registered project folders).

import * as fs from "node:fs";
import * as path from "node:path";

interface AppConfig {
  projects: string[];
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, "app-config.json");
}

export function loadAppConfig(userDataDir: string): AppConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(userDataDir), "utf8")) as Partial<AppConfig>;
    return { projects: Array.isArray(parsed.projects) ? parsed.projects.map(String) : [] };
  } catch {
    return { projects: [] };
  }
}

export function saveAppConfig(userDataDir: string, config: AppConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(config, null, 2), "utf8");
}
