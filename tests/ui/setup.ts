// Shared jsdom setup for renderer tests: fresh store, fresh window.cockpit
// mock and a clean DOM before every test.

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { installCockpitMock } from "./cockpit-mock";
import { resetStore } from "./store-helpers";

// jsdom has no matchMedia; CodeEditor and the theme code read it.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// CodeMirror measures text through Range client rects, which jsdom does not implement.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

beforeEach(() => {
  localStorage.clear();
  installCockpitMock();
  resetStore();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});
