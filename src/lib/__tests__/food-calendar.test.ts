import { describe, expect, it } from "vitest";
import { calendarSiteFood, monthlyCalendarFood, type FoodDeployment } from "../food-calendar";
import { assertPayrollDeductionLimits } from "../payroll-deduction-guard";
import type { PayrollBatch } from "../payroll";

describe("calendar-day food at 1 OMR", () => {
  it("charges October's 31 days, not the legacy flat 30", () => {
    expect(monthlyCalendarFood("2026-10", 30)).toBe(31);
  });
  it("charges November's 30 days", () => {
    expect(monthlyCalendarFood("2026-11", 30)).toBe(30);
  });
  it("uses February's actual length including leap years", () => {
    expect(monthlyCalendarFood("2026-02", 30)).toBe(28);
    expect(monthlyCalendarFood("2028-02", 30)).toBe(29);
  });
  it("preserves an explicit food exemption", () => {
    expect(monthlyCalendarFood("2026-10", 0)).toBe(0);
  });
  it("charges absent days", () => {
    expect(calendarSiteFood("2026-10", "A", [{ site: "A", work_date: "2026-10-01", status: "ABSENT" }], [], 30)).toBe(1);
  });
  it("charges weekoffs", () => {
    expect(calendarSiteFood("2026-10", "A", [{ site: "A", work_date: "2026-10-01", status: "WEEK_OFF" }], [], 30)).toBe(1);
  });
  it("splits a transfer on the deployment date including days without punches", () => {
    const deployments: FoodDeployment[] = [
      { employee_id: 144, site: "A", effective_from: "2026-10-01", effective_to: "2026-10-15" },
      { employee_id: 144, site: "B", effective_from: "2026-10-16", effective_to: null },
    ];
    expect(calendarSiteFood("2026-10", "A", [], deployments, 30)).toBe(15);
    expect(calendarSiteFood("2026-10", "B", [], deployments, 30)).toBe(16);
  });
  it("counts a date once even with duplicate attendance", () => {
    const entries = [{ site: "A", work_date: "2026-10-01" }, { site: "A", work_date: "2026-10-01" }];
    expect(calendarSiteFood("2026-10", "A", entries, [], 30)).toBe(1);
  });
  it("skips days marked -- before joining (joined day 11 of October)", () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({ site: "A", work_date: `2026-10-${String(i + 11).padStart(2, "0")}`, status: i % 7 ? "PRESENT" : "ABSENT" }));
    expect(calendarSiteFood("2026-10", "A", entries, [], 30)).toBe(21);
  });
  it("allows Employee 144's full calendar charge with absence and weekoff", () => {
    const batches = [{ id: "a", month: "2026-10", site: "A", status: "DRAFT", lines: [] }] as unknown as PayrollBatch[];
    const entries = [
      { employee_id: 144, site: "A", work_date: "2026-10-01", status: "PRESENT" },
      { employee_id: 144, site: "A", work_date: "2026-10-02", status: "ABSENT" },
      { employee_id: 144, site: "A", work_date: "2026-10-03", status: "WEEK_OFF" },
    ];
    expect(() => assertPayrollDeductionLimits([{ batch_id: "a", employee_id: 144, food_deduction: 31, prev_advance: 0, new_advance: 0, gross_pay: 300, other_deduction: 0 }], batches, [], entries, new Map([[144, 30]]))).not.toThrow();
  });
  it("saves employee 144 food above the daily amount when entered manually", () => {
    const batches = [
      { id: "a", month: "2026-10", site: "A", status: "PAID", lines: [{ employee_id: 144, food_deduction: 15, paid: 100 }] },
      { id: "b", month: "2026-10", site: "B", status: "DRAFT", lines: [] },
    ] as unknown as PayrollBatch[];
    const before = JSON.stringify(batches);
    const row = { batch_id: "b", employee_id: 144, food_deduction: 17, prev_advance: 0, new_advance: 0, gross_pay: 300, other_deduction: 0 };
    expect(() => assertPayrollDeductionLimits([row], batches, [], [], new Map([[144, 30]]))).not.toThrow();
    expect(() => assertPayrollDeductionLimits([{ ...row, food_deduction: 45 }], batches, [], [], new Map([[144, 30]]))).not.toThrow();
    expect(JSON.stringify(batches)).toBe(before);
  });
});