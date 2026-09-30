// CodeMirror wrapper: value sync without echo, onChange on user edits,
// read-only reconfiguration, language swap and the OS theme listener.
// CodeMirror renders fine in jsdom apart from layout measurement, which it
// tolerates.

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { CodeEditor } from "../../src/renderer/src/components/CodeEditor";
import { LazyCodeEditor } from "../../src/renderer/src/components/LazyCodeEditor";

function viewOf(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor") as HTMLElement;
  return EditorView.findFromDOM(dom) as EditorView;
}

/** Stubs matchMedia; only the colour-scheme query records listeners (CodeMirror also asks for "print"). */
function stubMatchMedia(matches: boolean): { listeners: Set<() => void>; removed: number; matches: boolean } {
  const listeners = new Set<() => void>();
  const state = { listeners, removed: 0, matches };
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const tracked = query.includes("prefers-color-scheme");
    return {
      get matches() {
        return tracked && state.matches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => {
        if (tracked) listeners.add(cb);
      },
      removeEventListener: (_: string, cb: () => void) => {
        if (!tracked) return;
        listeners.delete(cb);
        state.removed += 1;
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
  return state;
}

describe("CodeEditor", () => {
  it("mounts with the given text and reports user edits through onChange", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="hello" lang="markdown" onChange={onChange} minHeight="10px" />);
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("10px");
    const view = viewOf(container);
    expect(view.state.doc.toString()).toBe("hello");
    act(() => view.dispatch({ changes: { from: 5, insert: " world" } }));
    expect(onChange).toHaveBeenCalledWith("hello world");
  });

  it("syncs a new value prop into the editor without echoing it back", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeEditor value="a" lang="json" onChange={onChange} />);
    rerender(<CodeEditor value="b" lang="json" onChange={onChange} />);
    expect(viewOf(container).state.doc.toString()).toBe("b");
    expect(onChange).not.toHaveBeenCalled();
    rerender(<CodeEditor value="b" lang="json" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles read-only at runtime", () => {
    const { container, rerender } = render(<CodeEditor value="x" lang="toml" />);
    expect(viewOf(container).state.readOnly).toBe(false);
    rerender(<CodeEditor value="x" lang="toml" readOnly />);
    expect(viewOf(container).state.readOnly).toBe(true);
  });

  it("recreates the editor when the language changes and works without a language", () => {
    const { container, rerender } = render(<CodeEditor value="x" lang="text" />);
    const first = viewOf(container);
    rerender(<CodeEditor value="x" lang="markdown" />);
    const second = viewOf(container);
    expect(second).not.toBe(first);
    expect(second.state.doc.toString()).toBe("x");
  });

  it("follows the OS colour scheme and unsubscribes on unmount", () => {
    const media = stubMatchMedia(true);
    try {
      const { container, unmount } = render(<CodeEditor value="x" lang="text" />);
      const view = viewOf(container);
      expect(view.state.facet(EditorView.darkTheme)).toBe(true);
      expect(media.listeners.size).toBe(1);
      media.matches = false;
      act(() => {
        for (const cb of media.listeners) cb();
      });
      expect(view.state.facet(EditorView.darkTheme)).toBe(false);
      unmount();
      expect(media.removed).toBe(1);
      expect(container.querySelector(".cm-editor")).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("LazyCodeEditor", () => {
  it("shows a placeholder of the requested height, then the real editor", async () => {
    const { container, findByText } = render(<LazyCodeEditor value="lazy" lang="markdown" minHeight="33px" />);
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("33px");
    expect(await findByText("lazy")).toBeTruthy();
  });

  it("defaults the placeholder height to 200px", () => {
    const { container } = render(<LazyCodeEditor value="" lang="text" />);
    expect((container.firstChild as HTMLElement).style.minHeight).toBe("200px");
  });
});
