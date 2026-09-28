import { describe, expect, it } from "vitest";
import { formatBackupStamp } from "../src/lib/backup-stamp";

function localParts(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

describe("formatBackupStamp", () => {
  it("turns a file-safe UTC stamp into local date and time", () => {
    expect(formatBackupStamp("2026-09-27T10-11-12-123Z")).toBe(localParts("2026-09-27T10:11:12.123Z"));
  });

  it("ignores the collision suffix", () => {
    expect(formatBackupStamp("2026-09-27T10-11-12-123Z-2")).toBe(localParts("2026-09-27T10:11:12.123Z"));
  });

  it("returns unknown formats unchanged", () => {
    expect(formatBackupStamp("manual-copy")).toBe("manual-copy");
  });
});
