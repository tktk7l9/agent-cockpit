// Executes the lib-defined ScanSpec against the real filesystem.

import * as fs from "node:fs";
import { buildInventory, discoverProjects, projectMarkers } from "../lib/inventory";
import type { TaggedSnapshot } from "../lib/model/types";
import { claudeGlobalJsonPath, codexConfigPath, scanSpec, isPathDenied } from "../lib/paths";
import type { ScanResultPayload } from "../shared/ipc";
import { readTextIfExists } from "./fs-gateway";

function listDir(dir: string): { name: string; isDir: boolean }[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

function collectSnapshots(home: string, projectPaths: string[]): TaggedSnapshot[] {
  const spec = scanSpec(home, projectPaths);
  const snaps: TaggedSnapshot[] = [];
  for (const file of spec.files) {
    snaps.push({ ...file, text: readTextIfExists(file.path) });
  }
  for (const dirSpec of spec.dirs) {
    for (const entry of listDir(dirSpec.dir)) {
      if (entry.name.startsWith(".")) continue;
      if (dirSpec.type === "skillDirs") {
        if (!entry.isDir) continue;
        const filePath = `${dirSpec.dir}/${entry.name}/${dirSpec.fileInDir ?? "SKILL.md"}`;
        const text = readTextIfExists(filePath);
        if (text !== null) snaps.push({ tag: dirSpec.makeTag(entry.name), path: filePath, text });
      } else if (dirSpec.type === "mdFiles") {
        if (entry.isDir || !entry.name.endsWith(".md")) continue;
        const filePath = `${dirSpec.dir}/${entry.name}`;
        snaps.push({ tag: dirSpec.makeTag(entry.name.slice(0, -3)), path: filePath, text: readTextIfExists(filePath) });
      } else {
        if (entry.isDir || !entry.name.endsWith(".rules") || isPathDenied(entry.name)) continue;
        const filePath = `${dirSpec.dir}/${entry.name}`;
        snaps.push({ tag: dirSpec.makeTag(entry.name), path: filePath, text: readTextIfExists(filePath) });
      }
    }
  }
  return snaps;
}

function isInterestingProject(p: string): boolean {
  try {
    if (!fs.statSync(p).isDirectory()) return false;
  } catch {
    return false;
  }
  return projectMarkers(p).some((marker) => fs.existsSync(marker));
}

export function resolveProjects(home: string, manualProjects: string[]): string[] {
  const discovered = discoverProjects(
    readTextIfExists(claudeGlobalJsonPath(home)),
    readTextIfExists(codexConfigPath(home)),
  );
  const all = new Set<string>([...discovered, ...manualProjects]);
  return [...all].filter(isInterestingProject).sort();
}

export function runScan(home: string, manualProjects: string[]): ScanResultPayload {
  const projects = resolveProjects(home, manualProjects);
  const snaps = collectSnapshots(home, projects);
  const inventory = buildInventory(snaps, manualProjects);
  const scanned = new Set(projects);
  return {
    ...inventory,
    projects: inventory.projects.filter((p) => scanned.has(p.path)),
    home,
  };
}
