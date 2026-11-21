import { describe, expect, it } from "vitest";
import {
  applySelectedAttendanceDiffs,
  diffPayrollAttendance,
  type PayrollAttendanceSnapshotEntry,
} from "../payroll-attendance-refresh";

const row = (
  patch: Partial<PayrollAttendanceSnapshotEntry> = {},
): PayrollAttendanceSnapshotEntry => ({
  employee_id: 7,
  work_date: "2026-11-03",
  status: "PRESENT",
  regular_hours: 8,
  overtime_hours: 0,
  site: "North",
  project_id: "north-project",
  foreman: "Sam",
  ...patch,
});

describe("payroll attendance refresh", () => {
  it("reports status, hours, and site changes independently", () => {
    const before = [row()];
    const after = [
      row({
        status: "HALF_DAY",
        regular_hours: 4,
        site: "South",
        project_id: "south-project",
      }),
    ];

    expect(diffPayrollAttendance(before, after, new Set([7])).map(({ field }) => field)).toEqual([
      "Hours",
      "Site",
      "Status",
    ]);
  });

  it("applies only selected changes and shifts the saved site for allocation", () => {
    const before = [row()];
    const after = [
      row({
        regular_hours: 6,
        site: "South",
        project_id: "south-project",
      }),
    ];
    const diffs = diffPayrollAttendance(before, after, new Set([7]));
    const siteDiff = diffs.find((diff) => diff.field === "Site")!;

    expect(applySelectedAttendanceDiffs(before, after, diffs, new Set([siteDiff.id]))).toEqual([
      row({ site: "South", project_id: "south-project" }),
    ]);
  });

  it("reports added and removed records and missing payroll employees", () => {
    const before = [row()];
    const after = [row({ work_date: "2026-11-04" })];
    const diffs = diffPayrollAttendance(before, after, new Set());

    expect(diffs.map((diff) => diff.kind)).toContain("removed");
    expect(diffs.map((diff) => diff.kind)).toContain("added");
    expect(diffs.map((diff) => diff.kind)).toContain("missing");
  });
});
