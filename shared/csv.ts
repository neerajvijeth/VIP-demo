/** RFC 4180 quoting plus CSV-injection protection (leading = + - @ get a single quote prefix). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number' && Number.isFinite(v))) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export const csvRow = (vals: unknown[]) => vals.map(csvCell).join(',') + '\r\n';
