import { useMemo, useState } from "react";
import { buildDiffLines } from "../../../lib/diff";
import { buildFrontmatterFile } from "../../../lib/markdown/frontmatter";
import type { SkillEntity } from "../../../lib/model/types";
import { counterpartsOf, skillKey } from "../../../lib/skill-sync";
import { useStore } from "../store";
import { AGENT_LABEL, AgentBadge } from "./ui";

type SyncAgent = "claude" | "codex" | "cursor";
const SYNC_AGENTS: SyncAgent[] = ["claude", "codex", "cursor"];

function skillsDirFor(agent: SyncAgent, home: string): string {
  return `${home}/.${agent}/skills`;
}

/** Directory containing a skill, derived from "<dir>/<key>/SKILL.md". */
function dirOfSkill(entity: SkillEntity): string {
  const parts = entity.filePath.split("/");
  return parts.slice(0, parts.length - 2).join("/");
}

/** name/description/version + body, normalized the same way skillsIdentical compares them. */
function normalizedText(skill: Pick<SkillEntity, "name" | "description" | "version" | "body">): string {
  const fm: Record<string, unknown> = { name: skill.name, description: skill.description };
  if (skill.version !== undefined && skill.version !== "") fm.version = skill.version;
  return buildFrontmatterFile(fm, skill.body);
}

interface Props {
  entity: SkillEntity;
  all: SkillEntity[];
  home: string;
}

export function SkillCompare({ entity, all, home }: Props): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const counterparts = useMemo(() => counterpartsOf(entity, all), [entity, all]);
  const [index, setIndex] = useState(0);
  const counterpart = counterparts[Math.min(index, counterparts.length - 1)];

  const key = skillKey(entity.filePath);
  const missingAgents = SYNC_AGENTS.filter((a) => a !== entity.agent && !counterparts.some((c) => c.entity.agent === a));
  const [targetAgent, setTargetAgent] = useState<SyncAgent | undefined>(missingAgents[0]);

  const copyToOther = (): void => {
    if (!counterpart) return;
    void requestPreview({
      op: "upsertSkill",
      dir: dirOfSkill(counterpart.entity),
      name: key,
      prevName: key,
      description: entity.description,
      version: entity.version,
      body: entity.body,
    });
  };

  const copyFromOther = (): void => {
    if (!counterpart) return;
    void requestPreview({
      op: "upsertSkill",
      dir: dirOfSkill(entity),
      name: key,
      prevName: key,
      description: counterpart.entity.description,
      version: counterpart.entity.version,
      body: counterpart.entity.body,
    });
  };

  const copyToMissingAgent = (): void => {
    if (!targetAgent) return;
    void requestPreview({
      op: "upsertSkill",
      dir: skillsDirFor(targetAgent, home),
      name: key,
      prevName: key,
      description: entity.description,
      version: entity.version,
      body: entity.body,
    });
  };

  return (
    <div className="field">
      <label>Compare across agents</label>
      <p className="muted small">
        Same-named skills are compared on name/description/version/body — per-agent frontmatter extras are ignored
        and always preserved on copy.
      </p>

      {counterparts.length === 0 ? (
        <>
          <p className="muted small">No counterpart in other agents.</p>
          {missingAgents.length > 0 && (
            <div className="row-gap">
              <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value as SyncAgent)}>
                {missingAgents.map((a) => (
                  <option key={a} value={a}>
                    {AGENT_LABEL[a]}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" onClick={copyToMissingAgent}>
                Copy to…
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {counterparts.length > 1 && (
            <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
              {counterparts.map((c, i) => (
                <option key={c.entity.id} value={i}>
                  {AGENT_LABEL[c.entity.agent]} {c.identical ? "(synced)" : "(differs)"}
                </option>
              ))}
            </select>
          )}
          {counterpart && (
            <>
              <div className="entity-row-top">
                <AgentBadge agent={counterpart.entity.agent} />
                <span className={counterpart.identical ? "tag" : "tag tag-warn"}>
                  {counterpart.identical ? "≡ synced" : "≠ differs"}
                </span>
              </div>
              <pre className="diff">
                {buildDiffLines(normalizedText(counterpart.entity), normalizedText(entity)).map((line, i) => (
                  <span key={i} className={`diff-${line.type}`}>
                    {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
                    {line.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
              <div className="row-gap">
                <button className="btn btn-small" onClick={copyToOther} disabled={counterpart.identical}>
                  Copy to {AGENT_LABEL[counterpart.entity.agent]}…
                </button>
                <button className="btn btn-small" onClick={copyFromOther} disabled={counterpart.identical}>
                  Copy from {AGENT_LABEL[counterpart.entity.agent]}…
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
