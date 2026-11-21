import { advanceCarryForward, toNum, type AdvanceTx, type PayrollBatch, type PayrollLine } from "./payroll";
import { lastActiveSite, sameSite, type SiteEntry } from "./multi-site-payroll";
import { calendarSiteFood, monthlyCalendarFood, type FoodDeployment } from "./food-calendar";
import { hasProtectedPayrollPayment } from "./payroll-deletion";

export interface GuardedPayrollRow {
  id?: string;
  batch_id: string;
  employee_id: number;
  food_deduction: number;
  prev_advance: number;
  new_advance: number;
  gross_pay: number;
  other_deduction: number;
}

/** Fresh server preflight; atomic database enforcement is still needed for races. */
export function assertPayrollDeductionLimits(
  rows: GuardedPayrollRow[],
  batches: PayrollBatch[],
  advances: AdvanceTx[],
  entries: Array<SiteEntry & { employee_id: number }>,
  foodDefaults: ReadonlyMap<number, number>,
  deployments: FoodDeployment[] = [],
): void {
  const replacedIds = new Set(rows.flatMap((row) => row.id ? [row.id] : []));
  const reserved = batches.map((batch) => ({ ...batch, lines: batch.lines.filter((line) => !line.id || !replacedIds.has(line.id)) }));
  for (const row of rows) {
    const batch = batches.find((item) => item.id === row.batch_id);
    if (!batch) throw new Error("Payroll batch was not found.");
    if (hasProtectedPayrollPayment(batch)) throw new Error("Paid payroll records cannot be changed by this save.");
    const amounts = [row.food_deduction, row.prev_advance, row.new_advance, row.gross_pay, row.other_deduction];
    if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error("Payroll deductions and earnings must be valid non-negative amounts.");
    const foodSetting = foodDefaults.get(row.employee_id) ?? 0;
    const monthlyFood = monthlyCalendarFood(batch.month, foodSetting);
    const monthEntries = entries.filter((entry) => entry.employee_id === row.employee_id && entry.work_date.startsWith(`${batch.month}-`));
    const allSites = ["", "multiple sites", "all sites"].includes(batch.site.trim().toLowerCase());
    const siteFood = calendarSiteFood(batch.month, batch.site, monthEntries, deployments.filter((entry) => entry.employee_id === row.employee_id), foodSetting);
    const otherLines = reserved.filter((item) => item.month === batch.month).flatMap((item) => item.lines).filter((line) => Number(line.employee_id) === row.employee_id);
    const foodUsed = otherLines.reduce((sum, line) => sum + toNum(line.food_deduction), 0);
    if (row.food_deduction > siteFood + 0.001 || foodUsed + row.food_deduction > monthlyFood + 0.001) {
      const allowed = Math.max(0, Math.min(siteFood, monthlyFood - foodUsed));
      throw new Error(`Employee ${row.employee_id}: food deduction exceeds the site's calendar-day limit or remaining monthly food amount. Maximum for this line: ${allowed.toFixed(3)} OMR; site: ${siteFood} OMR; month: ${monthlyFood} OMR; already deducted: ${foodUsed.toFixed(3)} OMR. Reduce Food to ${allowed.toFixed(3)} OMR or correct the dated site deployment.`);
    }
    const latestSite = lastActiveSite(monthEntries);
    if (row.prev_advance > 0 && latestSite && !allSites && !sameSite(latestSite, batch.site)) {
      throw new Error(`Employee ${row.employee_id}: recover personal advances only in the last active site's payroll batch.`);
    }
    const opening = advanceCarryForward(row.employee_id, batch.month, batches, advances);
    const available = opening + otherLines.reduce((sum, line) => sum + toNum(line.new_advance) - toNum(line.prev_advance), 0) + row.new_advance;
    if (row.prev_advance > Math.max(0, available) + 0.001) throw new Error(`Employee ${row.employee_id}: advance deduction exceeds the remaining balance after other site batches.`);
    if (row.prev_advance > Math.max(0, row.gross_pay - row.food_deduction - row.other_deduction) + 0.001) throw new Error(`Employee ${row.employee_id}: advance deduction exceeds site net earnings.`);
    const reservedBatch = reserved.find((item) => item.id === row.batch_id);
    reservedBatch?.lines.push({ ...row } as unknown as PayrollLine);
  }
}