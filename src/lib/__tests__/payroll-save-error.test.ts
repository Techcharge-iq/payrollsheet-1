import { describe, expect, it } from "vitest";
import { payrollSaveErrorMessage } from "../payroll-save-error";

describe("payroll duplicate errors", () => {
  it("identifies the employee-month constraint without recommending replacement of existing payroll", () => {
    const message = payrollSaveErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "payroll_lines_unique_emp_month"' });
    expect(message).toContain("one payroll entry per employee per month");
    expect(message).toContain("batch-scoped uniqueness repair");
    expect(message).toContain("Do not delete or overwrite");
  });
  it("preserves unrelated duplicate error details", () => {
    expect(payrollSaveErrorMessage({ code: "23505", message: "duplicate employee in batch" })).toBe("Could not save payroll lines: duplicate employee in batch");
  });
});