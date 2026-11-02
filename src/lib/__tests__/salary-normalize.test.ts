import { describe, expect, it } from "vitest";
import { effectiveRateOnDate, normalizeSalaryHistory } from "../salary-history";

describe("salary history column compatibility", () => {
  it("uses legacy effective_on dates when effective_from is missing", () => {
    const rows = normalizeSalaryHistory([{ employee_id: 1, hourly_rate: 2.5, effective_on: "2026-10-01" }]);
    expect(effectiveRateOnDate(1, "2026-10-15", rows)).toBe(2.5);
  });
  it("still ignores undated rows", () => {
    const rows = normalizeSalaryHistory([{ employee_id: 1, hourly_rate: 9 }]);
    expect(effectiveRateOnDate(1, "2026-10-15", rows)).toBeUndefined();
  });
});
