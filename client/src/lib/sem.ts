import type { Condition } from '@shared/types';
import { L, semantics } from '@shared/semantics';

/** Condition on a LOGICAL column name (resolved to the physical column through COLUMN_MAP). */
export const lcond = (logical: string, operator: string, value: any = null): Condition => ({ type: 'condition', field: L(logical), operator, value, not: false });

/** "Open" finding = state is not one of the configured closed states. */
export function openCond(): Condition {
  const closed = semantics().values.closedStates;
  return closed.length === 1 ? lcond('te_state', 'is not', closed[0]) : lcond('te_state', 'is none of', closed);
}
/** Severity is one of the configured "high" severities. */
export const critHighCond = (): Condition => lcond('severity', 'is one of', semantics().values.highSeverities);
