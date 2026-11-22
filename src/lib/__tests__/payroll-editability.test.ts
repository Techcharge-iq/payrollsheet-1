import { describe, expect, it } from "vitest";
import type { PayrollBatch, PayrollLine } from "../payroll";
import { assertPaidBatchIdentityUnchanged, assertPayrollLineEditable, canEditPayrollEmployees, editablePayrollLines, hasLinePayment } from "../payroll-editability";

const paid = { id: "paid", employee_id: 1, paid: 163.05, hours: 100, food_deduction: 31, prev_advance: 10 } as PayrollLine;
const unpaid = { id: "unpaid", employee_id: 2, paid: 0, hours: 80, food_deduction: 31, prev_advance: 20 } as PayrollLine;
const batch = { id: "batch", month: "2026-10", site: "T-59", foreman: "", status: "DRAFT", lines: [paid, unpaid] } as PayrollBatch;

describe("individual payment protection", () => {
  it("one paid employee does not freeze the unpaid employee", () => {
    expect(canEditPayrollEmployees(batch)).toBe(true);
    expect(() => assertPayrollLineEditable(batch, unpaid)).not.toThrow();
  });
  it("protects an employee even after a partial payment", () => {
    expect(() => assertPayrollLineEditable(batch, paid)).toThrow("Employee 1 is protected");
  });
  it("writes only unpaid rows while preserving all paid amounts and deductions", () => {
    const before = JSON.stringify(paid);
    const submitted = [{ ...paid, hours: 999 }, { ...unpaid, hours: 90 }];
    expect(editablePayrollLines(batch, submitted)).toEqual([{ ...unpaid, hours: 90 }]);
    expect(JSON.stringify(paid)).toBe(before);
  });
  it("rejects removing a paid employee", () => {
    expect(() => editablePayrollLines(batch, [unpaid])).toThrow("cannot be removed");
  });
  it("rejects reassigning a paid employee", () => {
    expect(() => editablePayrollLines(batch, [{ ...paid, employee_id: 3 }, unpaid])).toThrow("reassigned");
  });
  it("allows posting the unpaid employee's first payment", () => {
    expect(editablePayrollLines(batch, [paid, { ...unpaid, paid: 100 }])).toEqual([{ ...unpaid, paid: 100 }]);
  });
  it.each(["PAID", "LOCKED"] as const)("keeps %s batches frozen", (status) => {
    expect(canEditPayrollEmployees({ ...batch, status })).toBe(false);
    expect(() => assertPayrollLineEditable({ ...batch, status }, unpaid)).toThrow("Paid payroll records");
  });
  it("keeps payment-marked batches frozen", () => {
    expect(canEditPayrollEmployees({ ...batch, paid_at: "2026-10-31" })).toBe(false);
    expect(canEditPayrollEmployees({ ...batch, paid_by: "admin" })).toBe(false);
  });
  it.each([null, undefined, "invalid", -1])("fails closed on payment amount %s", (paid) => {
    expect(hasLinePayment({ paid })).toBe(true);
  });
  it("preserves the identity of a batch containing payments", () => {
    expect(() => assertPaidBatchIdentityUnchanged(batch, { ...batch, site: "T-57" })).toThrow("keep its month, site");
    expect(() => assertPaidBatchIdentityUnchanged(batch, batch)).not.toThrow();
  });
});