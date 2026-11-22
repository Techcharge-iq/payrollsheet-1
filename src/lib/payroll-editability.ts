import type { PayrollBatch, PayrollLine } from "./payroll";

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