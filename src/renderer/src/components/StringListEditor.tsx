interface Props {
  label: string;
  items: string[];
  onChange(items: string[]): void;
}

export function StringListEditor({ label, items, onChange }: Props): React.JSX.Element {
  const update = (index: number, value: string): void => {
    onChange(items.map((item, i) => (i === index ? value : item)));
  };

  return (
    <div className="field">
      <label>{label}</label>
      {items.map((item, i) => (
        <div className="kv-row" key={i}>
          <input className="mono" value={item} onChange={(e) => update(i, e.target.value)} placeholder="Bash(npm run build)" />
          <button type="button" className="btn btn-icon" title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-small" onClick={() => onChange([...items, ""])}>
        + add
      </button>
    </div>
  );
}
