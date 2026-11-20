/**
 * Multi-site payroll rules (Option A):
 * - Earnings and food deduction are prorated by active attendance days at the site.
 * - Personal advances are recovered only in the batch for the employee's last active
 *   site of the month (latest attendance date), capped so net pay never goes negative.
 */
import { toNum, type PayrollBatch } from "./payroll";

export type SiteEntry = { work_date: string; site: string; status?: string | null };

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
export const sameSite = (a?: string | null, b?: string | null) => norm(a) === norm(b);

const isActive = (e: SiteEntry) => !e.status || e.status === "PRESENT" || e.status === "HALF_DAY";

/** Share of the month's active attendance days worked at `site` (1 when no site filter). */
export function siteDayShare(entries: SiteEntry[], site: string): number {
  if (!site) return 1;
  const all = new Set(entries.filter(isActive).map((e) => e.work_date));
  if (!all.size) return 1;
  const atSite = new Set(
    entries.filter((e) => isActive(e) && norm(e.site) === norm(site)).map((e) => e.work_date),
  );
  return atSite.size / all.size;
}

/** Site of the latest active attendance date in the period. */
export function lastActiveSite(entries: SiteEntry[]): string | null {
  const active = entries.filter(isActive).sort((a, b) => a.work_date.localeCompare(b.work_date));
  return active.at(-1)?.site.trim() ?? null;
}

/** Prior monthly food is the sum of that month's site lines, not its first line. */
export function priorMonthlyFood(batches: PayrollBatch[], employeeId: number, month: string, fallback: number): number {
  const prior = batches.filter((batch) => batch.month < month && batch.lines.some((line) => Number(line.employee_id) === employeeId));
  const latestMonth = prior.map((batch) => batch.month).sort().at(-1);
  if (!latestMonth) return fallback;
  return Math.round(prior.filter((batch) => batch.month === latestMonth).flatMap((batch) => batch.lines)
    .filter((line) => Number(line.employee_id) === employeeId)
    .reduce((sum, line) => sum + toNum(line.food_deduction), 0) * 1000) / 1000;
}

/** Reserve recoveries from every other site batch, including unpaid drafts. */
export function remainingAdvanceForBatch(batches: PayrollBatch[], employeeId: number | string, month: string, batchId: string | null, opening: number): number {
  const recovered = batches.filter((batch) => batch.month === month && batch.id !== batchId)
    .flatMap((batch) => batch.lines).filter((line) => String(line.employee_id) === String(employeeId))
    .reduce((sum, line) => sum + toNum(line.prev_advance), 0);
  return Math.max(0, Math.round((opening - recovered) * 1000) / 1000);
}

/** Specific-site drafts must not distribute their salary to other transfer sites. */
export function attendanceBelongsToBatch(entry: { site: string; project_id?: string | null }, batch: { site: string; project_id?: string | null }): boolean {
  const site = norm(batch.site);
  if (!site || site === "multiple sites" || site === "all sites") return true;
  if (batch.project_id && entry.project_id) return batch.project_id === entry.project_id;
  return sameSite(entry.site, batch.site);
}

/** Replace only editable draft allocations; retain finalized rows verbatim. */
export function mergeDraftAllocations<T extends { payroll_line_id: string }>(saved: T[], derived: T[], draftLineIds: ReadonlySet<string>): T[] {
  return [
    ...saved.filter((row) => !draftLineIds.has(row.payroll_line_id)),
    ...derived.filter((row) => draftLineIds.has(row.payroll_line_id)),
  ];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function proratedFood(monthlyFood: number, share: number) {
  return round3(monthlyFood * share);
}

/** Advance deduction for a site batch: 0 unless last site; never above net earnings. */
export function siteAdvanceDeduction(input: {
  pendingAdvance: number;
  grossSitePay: number;
  proratedFood: number;
  isLastSite: boolean;
}) {
  if (!input.isLastSite) return 0;
  const room = Math.max(0, input.grossSitePay - input.proratedFood);
  return round3(Math.max(0, Math.min(input.pendingAdvance, room)));
}
