import type { PayrollBatch, PayrollBatchStatus, PayrollLine } from "./payroll";

/** Status-only forward transitions never rewrite protected employee rows. */
export function assertPayrollStatusTransition(
  batch: Pick<PayrollBatch, "status" | "paid_at" | "paid_by"> & {
    lines: Array<{ paid: unknown; net_salary: unknown; net_pay?: unknown }>;
  },
  target: PayrollBatchStatus,
): void {
  if (batch.status === "PAID" || batch.paid_at || batch.paid_by)
    throw new Error("Finalised payroll cannot be reopened or changed.");
  const forward = (batch.status === "DRAFT" && target === "REVIEW") ||
    (batch.status === "REVIEW" && target === "APPROVED") ||
    (["APPROVED", "LOCKED"].includes(batch.status) && target === "PAID");
  const returnToDraft = batch.status === "REVIEW" && target === "DRAFT" &&
    !batch.lines.some(hasLinePayment);
  if (!forward && !returnToDraft)
    throw new Error("This payroll status change is not allowed; batches with payments can only move forward.");
  if (!batch.lines.length) throw new Error("Add employee lines before changing payroll status.");
  for (const line of batch.lines) {
    if (line.paid === null || line.paid === undefined || !Number.isFinite(Number(line.paid)) || Number(line.paid) < 0)
      throw new Error("Payroll has an invalid payment amount; review it before proceeding.");
  }
  if (target === "PAID") {
    let remaining = 0;
    for (const line of batch.lines) {
      const net = line.net_pay ?? line.net_salary;
      if (net === null || net === undefined || !Number.isFinite(Number(net)) || Number(net) < 0)
        throw new Error("Payroll has an invalid net salary; review it before marking paid.");
      remaining += Math.max(0, Number(net) - Number(line.paid));
    }
    if (remaining > 0.001)
      throw new Error(`Cannot mark paid: ${remaining.toFixed(3)} OMR remains unpaid. Record the remaining employee payments first.`);
  }
}

export function canTransitionPayrollStatus(batch: PayrollBatch, target: PayrollBatchStatus): boolean {
  try { assertPayrollStatusTransition(batch, target); return true; } catch { return false; }
}

/** Invalid/missing payment amounts are protected, never treated as unpaid. */
export function hasLinePayment(line: { paid: unknown }): boolean {
  if (line.paid === null || line.paid === undefined) return true;
  const amount = Number(line.paid);
  return !Number.isFinite(amount) || amount !== 0;
}

export function isPayrollBatchFinalized(batch: Pick<PayrollBatch, "status" | "paid_at" | "paid_by">): boolean {
  return batch.status === "PAID" || batch.status === "LOCKED" || !!batch.paid_at || !!batch.paid_by;
}

export function canEditPayrollEmployees(batch: PayrollBatch): boolean {
  return !isPayrollBatchFinalized(batch) && batch.lines.some((line) => !hasLinePayment(line));
}

/** Cost refresh follows the same line-level protection as the payroll editor. */
export function editableAllocationLineIds(
  batches: Array<Pick<PayrollBatch, "id" | "month" | "status" | "paid_at" | "paid_by">>,
  lines: Array<{ id: string; batch_id: string; month: string; paid: unknown }>,
  month: string,
): Set<string> {
  const editableBatches = new Set(batches.filter((batch) => batch.month === month && ["DRAFT", "REVIEW"].includes(batch.status) && !isPayrollBatchFinalized(batch)).map((batch) => batch.id));
  return new Set(lines.filter((line) => line.month === month && editableBatches.has(line.batch_id) && !hasLinePayment(line)).map((line) => line.id));
}

/** Only the stored line decides protection: entering a first payment must remain possible. */
export function assertPayrollLineEditable(batch: Pick<PayrollBatch, "status" | "paid_at" | "paid_by"> & { lines: Array<Pick<PayrollLine, "id" | "employee_id" | "paid">> }, row: Pick<PayrollLine, "id" | "employee_id">): void {
  const original = batch.lines.find((line) => row.id ? line.id === row.id : Number(line.employee_id) === Number(row.employee_id));
  if (isPayrollBatchFinalized(batch) || (original && hasLinePayment(original))) {
    throw new Error(`Paid payroll records cannot be changed. Employee ${row.employee_id} is protected.`);
  }
}

/** Preserve paid rows verbatim and never write them, even on a full-form save. */
export function editablePayrollLines(batch: PayrollBatch, submitted: PayrollLine[]): PayrollLine[] {
  if (isPayrollBatchFinalized(batch)) throw new Error("Paid payroll records cannot be changed.");
  const protectedLines = batch.lines.filter(hasLinePayment);
  for (const original of protectedLines) {
    const retained = submitted.find((line) => line.id === original.id);
    if (!original.id || !retained || Number(retained.employee_id) !== Number(original.employee_id)) {
      throw new Error("Paid employee lines cannot be removed or reassigned.");
    }
  }
  const protectedIds = new Set(protectedLines.map((line) => line.id));
  return submitted.filter((line) => !line.id || !protectedIds.has(line.id));
}

export function assertPaidBatchIdentityUnchanged(original: PayrollBatch, proposed: PayrollBatch): void {
  if (!original.lines.some(hasLinePayment)) return;
  for (const field of ["month", "site", "project_id", "foreman", "foreman_user_id"] as const) {
    if ((original[field] ?? null) !== (proposed[field] ?? null)) {
      throw new Error("This batch has payments: keep its month, site and batch foreman unchanged; edit unpaid employees only.");
    }
  }
}