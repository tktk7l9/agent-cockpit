// Decides whether a saved window rectangle is still on some connected
// display. Pure so main's real electron.screen.getAllDisplays() output can
// be tested without electron.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when `saved` overlaps at least one of the given work areas. */
export function boundsVisible(saved: Rect, workAreas: Rect[]): boolean {
  return workAreas.some(
    (a) => saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y,
  );
}
