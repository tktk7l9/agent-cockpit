import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { RevealButton } from "./ui";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ScanErrorsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.errorsOpen);
  const data = useStore((s) => s.data);
  const close = useStore((s) => s.closeErrors);
  const refresh = useStore((s) => s.refresh);
  const setSection = useStore((s) => s.setSection);
  const select = useStore((s) => s.select);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    modalRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  if (!open || !data) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const root = modalRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const openRaw = (path: string): void => {
    const entity = data.entities.find((e) => e.kind === "settings" && e.filePath === path);
    if (!entity) return;
    setSection("settings");
    select(entity.id);
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Scan errors"
      >
        <header>
          <h2>Scan errors</h2>
          <span className="muted">{data.errors.length} file(s)</span>
        </header>
        <div className="modal-body">
          {data.errors.map((err) => {
            const hasRaw = data.entities.some((e) => e.kind === "settings" && e.filePath === err.path);
            return (
              <section key={err.path} className="diff-file">
                <div className="diff-file-head">
                  <code className="mono" title={err.path}>
                    {err.path}
                  </code>
                </div>
                <p className="muted">{err.message}</p>
                <div className="row-gap">
                  <RevealButton path={err.path} />
                  {hasRaw && (
                    <button className="btn btn-small" onClick={() => openRaw(err.path)}>
                      Open raw
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <footer>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn btn-primary" onClick={() => void refresh()}>
            Rescan
          </button>
        </footer>
      </div>
    </div>
  );
}
