export type AllocationPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "NO_PAYMENT_DUE";

export interface PaymentAllocation {
  payrollLineId: string;
  employeeId: number;
  netPayable: number;
  paid: number;
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
