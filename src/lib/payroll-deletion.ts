export interface DeletablePayrollBatch {
  status: string;
  paid_at?: string | null | undefined;
  paid_by?: string | null | undefined;
  lines: Array<{ paid: unknown }>;
}

/** Payment markers and any nonzero payment protect the whole batch. */
export function hasProtectedPayrollPayment(batch: DeletablePayrollBatch): boolean {
  return batch.status === "PAID" || batch.status === "LOCKED" || !!batch.paid_at || !!batch.paid_by || batch.lines.some((line) => {
    if (line.paid === null || line.paid === undefined) return true;
    const paid = Number(line.paid);
    return !Number.isFinite(paid) || paid !== 0;
  });
}

export function canDeleteUnpaidPayroll(batch: DeletablePayrollBatch): boolean {
  if (!["DRAFT", "REVIEW", "APPROVED", "LEGACY"].includes(batch.status)) return false;
  return !hasProtectedPayrollPayment(batch);
}

export function assertUnpaidPayrollDeletion(batch: DeletablePayrollBatch): void {
  if (!canDeleteUnpaidPayroll(batch)) {
    throw new Error("This payroll batch has payment recorded or is locked and cannot be deleted. Paid records are protected.");
  }
}