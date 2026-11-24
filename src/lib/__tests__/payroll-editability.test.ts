import { describe, expect, it } from "vitest";
import type { PayrollBatch, PayrollLine } from "../payroll";
import { assertPaidBatchIdentityUnchanged, assertPayrollLineEditable, assertPayrollStatusTransition, canEditPayrollEmployees, editableAllocationLineIds, editablePayrollLines, hasLinePayment } from "../payroll-editability";
import { canDeleteUnpaidPayroll } from "../payroll-deletion";
import { mergeDraftAllocations } from "../multi-site-payroll";

const paid = { id: "paid", employee_id: 1, paid: 163.05, hours: 100, food_deduction: 31, prev_advance: 10 } as PayrollLine;
const unpaid = { id: "unpaid", employee_id: 2, paid: 0, hours: 80, food_deduction: 31, prev_advance: 20 } as PayrollLine;
const batch = { id: "batch", month: "2026-10", site: "T-59", foreman: "", status: "DRAFT", lines: [paid, unpaid] } as PayrollBatch;

describe("individual payment protection", () => {
  it("allows a partially paid Draft to progress through review and approval without rewriting paid rows", () => {
    const before = JSON.stringify(batch);
    expect(() => assertPayrollStatusTransition(batch, "REVIEW")).not.toThrow();
    expect(() => assertPayrollStatusTransition({ ...batch, status: "REVIEW" }, "APPROVED")).not.toThrow();
    expect(JSON.stringify(batch)).toBe(before);
    expect(canDeleteUnpaidPayroll(batch)).toBe(false);
  });
  it("does not reopen a payment-bearing Review or finalised batch", () => {
    expect(() => assertPayrollStatusTransition({ ...batch, status: "REVIEW" }, "DRAFT")).toThrow("only move forward");
    expect(() => assertPayrollStatusTransition({ ...batch, status: "PAID" }, "DRAFT")).toThrow("Finalised");
    expect(() => assertPayrollStatusTransition({ ...batch, paid_at: "2026-10-31" }, "REVIEW")).toThrow("Finalised");
  });
  it("allows Paid when salaries are partly paid across employees", () => {
    const lines = [{ paid: 40, net_salary: 100 }, { paid: 60, net_salary: 60 }];
    expect(() => assertPayrollStatusTransition({ ...batch, status: "APPROVED", lines }, "PAID")).not.toThrow();
  });
  it("allows marking a partly paid approved batch as paid", () => {
    expect(() => assertPayrollStatusTransition({ ...batch, status: "APPROVED", lines: [{ paid: 50, net_salary: 200 }] }, "PAID")).not.toThrow();
  });
  it.each([null, undefined, "invalid", -1])("blocks forward status changes with invalid payments %s", (paid) => {
    expect(() => assertPayrollStatusTransition({ ...batch, lines: [{ paid, net_salary: 100 }] }, "REVIEW")).toThrow("invalid payment");
  });
  it("refreshes only unpaid cost rows in a partially paid draft", () => {
    const lines = [paid, unpaid].map((line) => ({ id: line.id ?? "", batch_id: batch.id, month: batch.month, paid: line.paid }));
    const ids = editableAllocationLineIds([batch], lines, batch.month);
    expect([...ids]).toEqual(["unpaid"]);
    const saved = [{ payroll_line_id: "paid", hours: 100 }, { payroll_line_id: "unpaid", hours: 80 }];
    const derived = [{ payroll_line_id: "paid", hours: 999 }, { payroll_line_id: "unpaid", hours: 90 }];
    expect(mergeDraftAllocations(saved, derived, ids)).toEqual([{ payroll_line_id: "paid", hours: 100 }, { payroll_line_id: "unpaid", hours: 90 }]);
  });
  it("does not refresh allocations of a finalized batch", () => {
    const ids = editableAllocationLineIds([{ ...batch, status: "PAID" }], [{ id: "unpaid", batch_id: batch.id, month: batch.month, paid: 0 }], batch.month);
    expect(ids.size).toBe(0);
  });
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