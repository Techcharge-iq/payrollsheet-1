export interface DeletablePayrollBatch {
  status: string;
  paid_at?: string | null | undefined;
  lines: Array<{ paid: unknown }>;
}

/** Payment markers and any nonzero payment protect the whole batch. */
export function canDeleteUnpaidPayroll(batch: DeletablePayrollBatch): boolean {
  if (!["DRAFT", "REVIEW", "APPROVED", "LEGACY"].includes(batch.status)) return false;
  if (batch.paid_at) return false;
  return batch.lines.every((line) => {
    const paid = Number(line.paid);
    return Number.isFinite(paid) && paid === 0;
  });
}

export function assertUnpaidPayrollDeletion(batch: DeletablePayrollBatch): void {
  if (!canDeleteUnpaidPayroll(batch)) {
    throw new Error("This payroll batch has payment recorded or is locked and cannot be deleted. Paid records are protected.");
  }
}