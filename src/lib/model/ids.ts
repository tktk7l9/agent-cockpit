import type { AgentId, EntityKind, Scope } from "./types";

export function scopeKey(scope: Scope): string {
  return scope.level === "user" ? "user" : `proj:${scope.projectPath}`;
}

export function entityId(agent: AgentId, kind: EntityKind, scope: Scope, name: string): string {
  return `${agent}:${kind}:${scopeKey(scope)}:${name}`;
}
