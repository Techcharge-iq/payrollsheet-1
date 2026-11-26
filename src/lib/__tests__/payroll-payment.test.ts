import { describe, expect, it } from "vitest";
import {
  allocationPaymentStatus,
  remainingAllocationBalance,
  validatePaymentAmount,
} from "../payroll-payment";

describe("payroll payment allocation", () => {
  it("keeps two site allocations separate", () => {
    const iris = { payrollLineId: "iris", employeeId: 1, netPayable: 150, paid: 150 };
    const t61 = { payrollLineId: "t61", employeeId: 1, netPayable: 200, paid: 100 };
    expect(remainingAllocationBalance(iris)).toBe(0);
    expect(remainingAllocationBalance(t61)).toBe(100);
  });

  it("supports multiple instalments and final settlement", () => {
    const line = { payrollLineId: "line", employeeId: 1, netPayable: 200, paid: 75 };
    expect(validatePaymentAmount(line, 75)).toBeNull();
    expect(validatePaymentAmount(line, 125)).toBeNull();
    expect(validatePaymentAmount(line, 126)).not.toBeNull();
  });

  it("rejects overpayment and non-positive payments", () => {
    const line = { payrollLineId: "line", employeeId: 1, netPayable: 100, paid: 40 };
    expect(validatePaymentAmount(line, 61)).not.toBeNull();
    expect(validatePaymentAmount(line, 0)).not.toBeNull();
  });

  it("reports unpaid, partial, paid and no-due statuses", () => {
    expect(
      allocationPaymentStatus({ payrollLineId: "a", employeeId: 1, netPayable: 100, paid: 0 }),
    ).toBe("UNPAID");
    expect(
      allocationPaymentStatus({ payrollLineId: "b", employeeId: 1, netPayable: 100, paid: 30 }),
    ).toBe("PARTIALLY_PAID");
    expect(
      allocationPaymentStatus({ payrollLineId: "c", employeeId: 1, netPayable: 100, paid: 100 }),
    ).toBe("PAID");
    expect(
      allocationPaymentStatus({ payrollLineId: "d", employeeId: 1, netPayable: 0, paid: 0 }),
    ).toBe("NO_PAYMENT_DUE");
  });
});

describe("approved payment adjustments", async () => {
  const { employeeMonthBalances, missingPayrollSites, validateApprovedPaymentAdjustment } = await import("../payroll-payment");
  const partial = { payrollLineId: "a", employeeId: 1, netPayable: 200, paid: 50, batchStatus: "APPROVED" };
  it("tops up only the remaining balance", () => {
    expect(validateApprovedPaymentAdjustment(partial, 150, "ADD")).toBeNull();
    expect(validateApprovedPaymentAdjustment(partial, 151, "ADD")).not.toBeNull();
  });
  it("requires a reason to correct a partial payment and protects fully paid records", () => {
    expect(validateApprovedPaymentAdjustment(partial, 40, "CORRECT", "")).not.toBeNull();
    expect(validateApprovedPaymentAdjustment(partial, 40, "CORRECT", "Typing error")).toBeNull();
    expect(validateApprovedPaymentAdjustment({ ...partial, paid: 200 }, 10, "CORRECT", "Typing error")).not.toBeNull();
  });
  it("finds other unpaid sites and attendance sites with no payroll", () => {
    const rows = [{ ...partial, month: "2026-10", siteName: "T-57", siteId: "s1" }, { ...partial, payrollLineId: "b", paid: 0, month: "2026-10", siteName: "T-59", siteId: "s2" }];
    expect(employeeMonthBalances(rows, 1, "2026-10").map((r) => r.siteName)).toEqual(["T-57", "T-59"]);
    expect(missingPayrollSites(rows, [{ employee_id: 1, work_date: "2026-10-20", site: "Adam", project_id: "s3", regular_hours: 8 }], 1, "2026-10")).toEqual(["Adam"]);
  });
});
