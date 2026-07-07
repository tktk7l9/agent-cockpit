import { useState } from "react";
import { MASK } from "../../../lib/redact";

interface Props {
  label: string;
  entries: [string, string][];
  onChange(entries: [string, string][]): void;
  maskValues?: boolean;
}

export function KvEditor({ label, entries, onChange, maskValues = false }: Props): React.JSX.Element {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const update = (index: number, key: string, value: string): void => {
    const next = entries.map((entry, i) => (i === index ? ([key, value] as [string, string]) : entry));
    onChange(next);
  };

  const toggleReveal = (index: number): void => {
    const next = new Set(revealed);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setRevealed(next);
  };

  return (
    <div className="field">
      <label>{label}</label>
      {entries.map(([key, value], i) => {
        const hidden = maskValues && !revealed.has(i);
        return (
          <div className="kv-row" key={i}>
            <input placeholder="NAME" value={key} onChange={(e) => update(i, e.target.value, value)} />
            <input
              placeholder="value"
              type={hidden ? "password" : "text"}
              value={hidden ? MASK : value}
              readOnly={hidden}
              onChange={(e) => update(i, key, e.target.value)}
            />
            {maskValues && (
              <button type="button" className="btn btn-icon" title={hidden ? "Reveal" : "Hide"} onClick={() => toggleReveal(i)}>
                {hidden ? "👁" : "🙈"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-icon"
              title="Remove"
              onClick={() => onChange(entries.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button type="button" className="btn btn-small" onClick={() => onChange([...entries, ["", ""]])}>
        + add
      </button>
    </div>
  );
}
