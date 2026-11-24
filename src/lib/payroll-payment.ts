export type AllocationPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "NO_PAYMENT_DUE";

export interface PaymentAllocation {
  payrollLineId: string;
  employeeId: number;
  netPayable: number;
  paid: number;
}

export function validateApprovedPaymentAdjustment(
  allocation: PaymentAllocation & { batchStatus: string },
  amount: number,
  mode: "ADD" | "CORRECT",
  reason = "",
): string | null {
  if (allocation.batchStatus !== "APPROVED") return "Only Approved payroll can receive adjustments.";
  if (!Number.isFinite(allocation.paid) || !Number.isFinite(allocation.netPayable) || allocation.paid < 0)
    return "Invalid payment balance; refresh and review the record.";
  if (allocation.paid >= allocation.netPayable - 0.0005) return "Fully paid records are protected.";
  if (mode === "ADD") return validatePaymentAmount(allocation, amount);
  if (allocation.paid <= 0) return "Only a partial payment can be corrected.";
  if (reason.trim().length < 3) return "Enter a reason for this correction.";
  if (!Number.isFinite(amount) || amount < 0 || amount > allocation.netPayable)
    return "Corrected paid total must be between zero and net payable.";
  if (Math.abs(amount - allocation.paid) < 0.0005) return "Enter a different paid total.";
  return null;
}

export function employeeMonthBalances<T extends PaymentAllocation & { month: string; siteName: string }>(
  allocations: T[], employeeId: number, month: string,
): T[] {
  return allocations.filter((a) => a.employeeId === employeeId && a.month === month && remainingAllocationBalance(a) > 0);
}

export function missingPayrollSites(
  allocations: Array<PaymentAllocation & { month: string; siteName: string; siteId: string | null }>,
  attendance: Array<{ employee_id: number; work_date: string; site: string | null; project_id: string | null; regular_hours: number | null }>,
  employeeId: number, month: string,
): string[] {
  const existing = allocations.filter((a) => a.employeeId === employeeId && a.month === month);
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return [...new Set(attendance.filter((day) => Number(day.employee_id) === employeeId && day.work_date.startsWith(`${month}-`) && Number(day.regular_hours) > 0 && !existing.some((a) =>
    a.siteId && day.project_id ? a.siteId === day.project_id : normalize(a.siteName) === normalize(day.site ?? ""),
  )).map((day) => day.site?.trim() || "Unassigned site"))];
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function remainingAllocationBalance(allocation: PaymentAllocation): number {
  return roundMoney(Math.max(0, allocation.netPayable - allocation.paid));
}

export function allocationPaymentStatus(allocation: PaymentAllocation): AllocationPaymentStatus {
  if (allocation.netPayable <= 0.0005) return "NO_PAYMENT_DUE";
  if (allocation.paid <= 0.0005) return "UNPAID";
  if (allocation.paid >= allocation.netPayable - 0.0005) return "PAID";
  return "PARTIALLY_PAID";
}

export function validatePaymentAmount(
  allocation: PaymentAllocation,
  amount: number,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Payment amount must be greater than zero.";
  if (amount > remainingAllocationBalance(allocation) + 0.0005) {
    return "Payment amount exceeds the remaining balance.";
  }
  return null;
}
