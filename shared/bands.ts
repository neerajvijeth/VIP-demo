/** Server vulnerability score bands (on final_score) and their SLA reference. One definition for the SQL, the UI legend and the tests. */
export interface Band { label: 'Critical' | 'High' | 'Medium' | 'Low'; min?: number; max?: number; range: string; sla: string }
export const BANDS: Band[] = [
  { label: 'Critical', min: 85, range: '≥ 85', sla: '≤ 72 hours preferred, 7 days max' },
  { label: 'High', min: 70, max: 84, range: '70 – 84', sla: '7 – 14 days' },
  { label: 'Medium', min: 50, max: 69, range: '50 – 69', sla: '30 days' },
  { label: 'Low', max: 49, range: '< 50', sla: '90 days' },
];
export const BAND_ORDER = BANDS.map((b) => b.label);

/** CASE expression assigning a band to a score column; NULL scores belong to no band. */
export const bandSql = (score: string) =>
  `CASE WHEN ${score} >= 85 THEN 'Critical' WHEN ${score} >= 70 THEN 'High' WHEN ${score} >= 50 THEN 'Medium' WHEN ${score} IS NOT NULL THEN 'Low' END`;

/** Always the four bands, in severity order, zero when empty. */
export function fillBands(rows: Array<{ label: string; value: number }>): Array<{ label: Band['label']; value: number }> {
  const by = new Map(rows.map((r) => [r.label, Number(r.value) || 0]));
  return BAND_ORDER.map((label) => ({ label, value: by.get(label) ?? 0 }));
}

/** Weights behind the risk score (reference only; the score itself is precomputed as final_score). */
export const SCORE_WEIGHTS = [['KEV', 10], ['Internet exposure', 20], ['EPSS', 30], ['CVSS', 20], ['Asset criticality', 20]] as const;

/** More than `max` groups: keep the largest `max - 1` and fold the rest into "Other". */
export function groupSmall<T extends { label: string; value: number }>(rows: T[], max = 10): Array<{ label: string; value: number }> {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  return [...head, { label: 'Other', value: sorted.slice(max - 1).reduce((s, r) => s + r.value, 0) }];
}
