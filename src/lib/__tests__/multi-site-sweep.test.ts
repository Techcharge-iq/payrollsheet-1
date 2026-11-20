import { describe, expect, it } from "vitest";
import { attendanceBelongsToBatch, mergeDraftAllocations, priorMonthlyFood, remainingAdvanceForBatch } from "../multi-site-payroll";
import { employeeRows, advanceOutstanding, payrollEmployeeCount, payrollMonthCount, type PayrollBatch } from "../payroll";

const batch = (id: string, month: string, site: string, food: number, advance: number): PayrollBatch =>
  ({ id, month, site, foreman: "", status: "DRAFT", lines: [{ employee_id: 7, food_deduction: food, prev_advance: advance, new_advance: 0 }] }) as PayrollBatch;

describe("multi-site payroll sweep", () => {
  it("uses the previous month's full food amount across Adam and T-59", () => {
    expect(priorMonthlyFood([batch("a", "2026-09", "Adam", 15, 0), batch("b", "2026-09", "T-59", 15, 0)], 7, "2026-10", 60)).toBe(30);
  });
  it("keeps explicit zero and ignores older month deductions", () => {
    expect(priorMonthlyFood([batch("a", "2026-08", "Adam", 60, 0), batch("b", "2026-09", "T-59", 0, 0)], 7, "2026-10", 30)).toBe(0);
  });
  it("uses fallback only when no prior employee payroll exists", () => {
    expect(priorMonthlyFood([], 7, "2026-10", 30)).toBe(30);
  });
  it("reserves other sites' recoveries for manual entry, imports and approval", () => {
    const batches = [batch("a", "2026-10", "Adam", 15, 80), batch("b", "2026-10", "T-59", 15, 20)];
    expect(remainingAdvanceForBatch(batches, 7, "2026-10", "b", 100)).toBe(20);
    expect(remainingAdvanceForBatch(batches, 7, "2026-10", null, 100)).toBe(0);
  });
  it("keeps a draft site's cost allocation out of other transfer sites", () => {
    expect(attendanceBelongsToBatch({ site: "Adam" }, { site: "T-59" })).toBe(false);
    expect(attendanceBelongsToBatch({ site: " t-59 " }, { site: "T-59" })).toBe(true);
    expect(attendanceBelongsToBatch({ site: "T-59", project_id: "other" }, { site: "T-59", project_id: "selected" })).toBe(false);
    expect(attendanceBelongsToBatch({ site: "Adam" }, { site: "Multiple sites" })).toBe(true);
  });
  it("retains both site lines in employee history and sums recovery once per line", () => {
    const batches = [batch("a", "2026-10", "Adam", 15, 0), batch("b", "2026-10", "T-59", 15, 40)];
    expect(employeeRows(batches, 7).map((row) => row.site)).toEqual(["Adam", "T-59"]);
    expect(payrollEmployeeCount(batches)).toBe(1);
    expect(payrollMonthCount(employeeRows(batches, 7))).toBe(1);
    expect(advanceOutstanding(7, batches, [{ id: "tx", employee_id: 7, date: "2026-09-01", amount: 100, reason: "", payment_method: "Cash", notes: "" }])).toBe(60);
  });
  it("replaces incorrect draft allocations while leaving paid allocations unchanged", () => {
    const paid = { payroll_line_id: "paid", site: "Adam", gross: 300 };
    const wrongDraft = { payroll_line_id: "draft", site: "Adam", gross: 150 };
    const correctDraft = { payroll_line_id: "draft", site: "T-59", gross: 300 };
    const result = mergeDraftAllocations([paid, wrongDraft], [correctDraft, { ...paid, gross: 999 }], new Set(["draft"]));
    expect(result).toEqual([paid, correctDraft]);
    expect(result[0]).toBe(paid);
  });
});