// Backup file names are file-safe UTC ISO stamps ("2026-09-27T10-11-12-123Z",
// optionally "-N" on collision). Show them as local wall-clock time (SHIG 11).

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatBackupStamp(stamp: string): string {
  const m = STAMP.exec(stamp);
  if (!m) return stamp;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
