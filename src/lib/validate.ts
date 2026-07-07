// Input validation. Returns a list of human-readable problems; empty = valid.

import type { McpInput } from "./agents/mcp-common";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateEntityName(name: string): string[] {
  if (name.trim() === "") return ["name is required"];
  if (!NAME_RE.test(name)) return ["name may only contain letters, digits, dot, dash and underscore"];
  return [];
}

export function validateMcpInput(input: McpInput): string[] {
  const errors = validateEntityName(input.name);
  if (input.transport === "stdio") {
    if (!input.command || input.command.trim() === "") errors.push("command is required for stdio servers");
  } else {
    if (!input.url || !/^https?:\/\/.+/.test(input.url)) errors.push("a valid http(s) url is required for remote servers");
  }
  for (const key of Object.keys(input.env ?? {})) {
    if (key.trim() === "" || key.includes("=")) errors.push(`invalid env var name: "${key}"`);
  }
  for (const key of Object.keys(input.headers ?? {})) {
    if (key.trim() === "") errors.push("header names must not be empty");
  }
  if (input.startupTimeoutSec !== undefined && !(input.startupTimeoutSec > 0)) {
    errors.push("startup timeout must be a positive number of seconds");
  }
  return errors;
}

export function validateSkillInput(name: string, description: string): string[] {
  const errors = validateEntityName(name);
  if (description.trim() === "") errors.push("description is required");
  return errors;
}
