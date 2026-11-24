import { describe, expect, it } from "vitest";
import { assertPayrollDeductionLimits, type GuardedPayrollRow } from "../payroll-deduction-guard";
import type { PayrollBatch, AdvanceTx } from "../payroll";
const batches = [
  { id: "a", site: "Adam", month: "2026-10", status: "DRAFT", lines: [{ id: "la", employee_id: 7, food_deduction: 15, prev_advance: 0, new_advance: 0, paid: 0 }] },
  { id: "b", site: "T-59", month: "2026-10", status: "DRAFT", lines: [] },
] as unknown as PayrollBatch[];
const entries = [{ employee_id: 7, site: "Adam", work_date: "2026-10-01", status: "PRESENT" }, { employee_id: 7, site: "T-59", work_date: "2026-10-16", status: "PRESENT" }];
const advances = [{ employee_id: 7, date: "2026-09-01", amount: 100 }] as AdvanceTx[];
const defaults = new Map([[7, 30]]);
const row: GuardedPayrollRow = { batch_id: "b", employee_id: 7, food_deduction: 15, prev_advance: 100, new_advance: 0, gross_pay: 200, other_deduction: 0 };
describe("October multi-site save deduction guard", () => {
  it("allows prorated food and one advance deduction at T-59", () => {
    expect(() => assertPayrollDeductionLimits([row], batches, advances, entries, defaults)).not.toThrow();
  });
  it("does not recover employee 60 advances outside their final active site", () => {
    const employee60Entries = [
      { employee_id: 60, site: "Adam", work_date: "2026-10-05", status: "PRESENT" },
      { employee_id: 60, site: "T-59", work_date: "2026-10-21", status: "HALF_DAY" },
    ];
    const employee60Advance = [{ employee_id: 60, date: "2026-09-01", amount: 100 }] as AdvanceTx[];
    const employee60Row: GuardedPayrollRow = { batch_id: "a", employee_id: 60, food_deduction: 15, prev_advance: 100, new_advance: 0, gross_pay: 200, other_deduction: 0 };
    expect(() => assertPayrollDeductionLimits([employee60Row], batches, employee60Advance, employee60Entries, new Map([[60, 30]]))).toThrow("last active site");
  });
  it("does not recover employee 60 advances without an active attendance site", () => {
    const employee60Entries = [
      { employee_id: 60, site: "Adam", work_date: "2026-10-05", status: "ABSENT" },
    ];
    const employee60Advance = [{ employee_id: 60, date: "2026-09-01", amount: 100 }] as AdvanceTx[];
    const employee60Row: GuardedPayrollRow = { batch_id: "a", employee_id: 60, food_deduction: 15, prev_advance: 100, new_advance: 0, gross_pay: 200, other_deduction: 0 };
    expect(() => assertPayrollDeductionLimits([employee60Row], batches, employee60Advance, employee60Entries, new Map([[60, 30]]))).toThrow("last active site");
  });
  it("accepts a manually entered food amount above the daily suggestion", () => {
    expect(() => assertPayrollDeductionLimits([{ ...row, food_deduction: 45, prev_advance: 0 }], batches, advances, entries, defaults)).not.toThrow();
  });
  it("rejects advances at an earlier site", () => {
    expect(() => assertPayrollDeductionLimits([{ ...row, id: "la", batch_id: "a" }], batches, advances, entries, defaults)).toThrow("last active site");
  });
  it("reserves advances recovered in other batches", () => {
    const reserved = [{ ...batches[0], lines: [{ employee_id: 7, food_deduction: 15, prev_advance: 80, new_advance: 0, paid: 0 }] }, batches[1]] as PayrollBatch[];
    expect(() => assertPayrollDeductionLimits([row], reserved, advances, entries, defaults)).toThrow("remaining balance");
  });
  it("caps recovery at net site earnings", () => {
    expect(() => assertPayrollDeductionLimits([{ ...row, gross_pay: 100 }], batches, advances, entries, defaults)).toThrow("net earnings");
  });
  it("rejects changing paid lines without mutating them", () => {
    const paid = batches.map((batch) => batch.id === "b" ? { ...batch, status: "PAID" as const } : batch);
    const before = JSON.stringify(paid);
    expect(() => assertPayrollDeductionLimits([row], paid, advances, entries, defaults)).toThrow("Paid payroll records");
    expect(JSON.stringify(paid)).toBe(before);
  });
  it("protects partially paid draft lines even before the batch status changes", () => {
    const partial = batches.map((batch) => batch.id === "b" ? { ...batch, lines: [{ employee_id: 7, paid: 1 }] } : batch) as PayrollBatch[];
    expect(() => assertPayrollDeductionLimits([row], partial, advances, entries, defaults)).toThrow("Paid payroll records");
  });
  it("allows saving an unpaid coworker without changing a paid employee's deductions", () => {
    const partial = batches.map((batch) => batch.id === "b" ? { ...batch, lines: [{ id: "paid-coworker", employee_id: 8, paid: 163.05, food_deduction: 31, prev_advance: 25, new_advance: 0 }] } : batch) as PayrollBatch[];
    const before = JSON.stringify(partial);
    expect(() => assertPayrollDeductionLimits([row], partial, advances, entries, defaults)).not.toThrow();
    expect(JSON.stringify(partial)).toBe(before);
  });
});