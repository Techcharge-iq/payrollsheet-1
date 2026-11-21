import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "",
}));

import { readAttendanceImport } from "../attendance-import";

const employees = [
  { id: 12, name: "Sam Worker", id_number: "EMP-12" },
  { id: 13, name: "Lee Worker", id_number: "EMP-13" },
];

function csvFile(contents: string, name = "attendance.csv") {
  return new File([contents], name, { type: "text/csv" });
}

describe("monthly attendance imports", () => {
  it("maps validated employee/day rows and derives punches from hours", async () => {
    const rows = await readAttendanceImport(
      csvFile(
        [
          "Employee ID,Date,Site,Foreman,Status,Hours,Overtime Hours,Break Hours",
          "EMP-12,2026-11-02,North,Ali,Present,8,1,1",
        ].join("\n"),
      ),
      employees,
      "2026-11",
    );

    expect(rows).toEqual([
      {
        employeeId: 12,
        employeeName: "Sam Worker",
        workDate: "2026-11-02",
        site: "North",
        foreman: "Ali",
        status: "PRESENT",
        inTime: "06:00",
        outTime: "16:00",
        breakHours: 1,
        overtimeHours: 1,
      },
    ]);
  });

  it("rejects dates outside the selected month and duplicate employee days", async () => {
    const header = "Employee ID,Date,Site,Foreman,Status,In Time,Out Time";
    await expect(
      readAttendanceImport(
        csvFile(`${header}\nEMP-12,2026-10-02,North,Ali,Present,06:00,15:00`),
        employees,
        "2026-11",
      ),
    ).rejects.toThrow("selected month");

    await expect(
      readAttendanceImport(
        csvFile(
          `${header}\nEMP-12,2026-11-02,North,Ali,Present,06:00,15:00\nEMP-12,2026-11-02,North,Ali,Present,06:00,15:00`,
        ),
        employees,
        "2026-11",
      ),
    ).rejects.toThrow("more than one entry");
  });

  it("rejects rows that cannot be matched to a single employee", async () => {
    await expect(
      readAttendanceImport(
        csvFile(
          "Employee,Date,Site,Foreman,Status,In Time,Out Time\nUnknown,2026-11-02,North,Ali,Present,06:00,15:00",
        ),
        employees,
        "2026-11",
      ),
    ).rejects.toThrow("does not match exactly one employee");
  });
});

// ---------------------------------------------------------------------------
// Monthly matrix format tests
// ---------------------------------------------------------------------------
describe("monthly matrix attendance imports", () => {
  /**
   * Build a minimal CSV that looks like a monthly matrix sheet.
   * Header: Name of staff, Trade, 1, 2, 3, ..., 30, Total Hours
   * Rows: one per employee, cells are A/F/numeric/blank
   */
  function matrixCsv(
    days: Array<{ day: number; val: string }>,
    employees2: Array<{ name: string; trade: string; cells: Record<number, string> }>,
    totalDays = 30,
  ): string {
    const dayCols = Array.from({ length: totalDays }, (_, i) => i + 1);
    const header = ["Name of staff", "Trade", ...dayCols.map(String), "Total Hours"].join(",");
    const empRows = employees2.map(({ name, trade, cells }) => {
      const dayCells = dayCols.map((d) => cells[d] ?? "");
      return [name, trade, ...dayCells, ""].join(",");
    });
    return [header, ...empRows].join("\n");
  }

  it("parses numeric hours as PRESENT with derived punch times", async () => {
    const csv = matrixCsv(
      [],
      [{ name: "Sam Worker", trade: "Mason", cells: { 2: "8", 3: "9" } }],
    );
    const rows = await readAttendanceImport(
      csvFile(csv),
      employees,
      "2026-11",
      { site: "North", foreman: "Ali" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      employeeId: 12,
      workDate: "2026-11-02",
      status: "PRESENT",
      inTime: "06:00",
      outTime: "14:00", // 06:00 + 8h
      site: "North",
      foreman: "Ali",
      breakHours: 0,
      overtimeHours: 0,
    });
    expect(rows[1]).toMatchObject({
      workDate: "2026-11-03",
      status: "PRESENT",
      inTime: "06:00",
      outTime: "15:00", // 06:00 + 9h
    });
  });

  it("maps A → ABSENT, F → WEEKLY_OFF", async () => {
    const csv = matrixCsv(
      [],
      [{ name: "Sam Worker", trade: "Mason", cells: { 1: "A", 2: "F", 3: "8" } }],
    );
    const rows = await readAttendanceImport(
      csvFile(csv),
      employees,
      "2026-11",
      { site: "S", foreman: "F" },
    );

    expect(rows.find((r) => r.workDate === "2026-11-01")?.status).toBe("ABSENT");
    expect(rows.find((r) => r.workDate === "2026-11-02")?.status).toBe("WEEKLY_OFF");
    expect(rows.find((r) => r.workDate === "2026-11-03")?.status).toBe("PRESENT");
  });

  it("does NOT create records for blank leading/trailing cells", async () => {
    // Blanks before day 5 and after day 7 must be skipped entirely
    const csv = matrixCsv(
      [],
      [{ name: "Sam Worker", trade: "Mason", cells: { 5: "8", 6: "A", 7: "F" } }],
    );
    const rows = await readAttendanceImport(
      csvFile(csv),
      employees,
      "2026-11",
      { site: "S", foreman: "F" },
    );

    // Only days 5, 6, 7 should appear — no records for 1-4 or 8+
    expect(rows.map((r) => r.workDate)).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
  });

  it("does NOT create records for internal blank cells either", async () => {
    // Internal blanks (between first and last non-blank) are also skipped
    const csv = matrixCsv(
      [],
      [{ name: "Sam Worker", trade: "Mason", cells: { 3: "8", 5: "A" } }],
      // day 4 is blank between day 3 and day 5
    );
    const rows = await readAttendanceImport(
      csvFile(csv),
      employees,
      "2026-11",
      { site: "S", foreman: "F" },
    );
    // Only days 3 and 5 — blank day 4 is skipped
    expect(rows.map((r) => r.workDate)).toEqual(["2026-11-03", "2026-11-05"]);
  });

  it("handles two employees in the same sheet", async () => {
    const csv = matrixCsv(
      [],
      [
        { name: "Sam Worker", trade: "Mason", cells: { 1: "8" } },
        { name: "Lee Worker", trade: "Helper", cells: { 1: "A" } },
      ],
    );
    const rows = await readAttendanceImport(
      csvFile(csv),
      employees,
      "2026-11",
      { site: "S", foreman: "F" },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ employeeId: 12, status: "PRESENT" });
    expect(rows[1]).toMatchObject({ employeeId: 13, status: "ABSENT" });
  });

  it("throws a clear error when employee name is not found", async () => {
    const csv = matrixCsv(
      [],
      [{ name: "Ghost Person", trade: "???", cells: { 1: "8" } }],
    );
    await expect(
      readAttendanceImport(csvFile(csv), employees, "2026-11", { site: "S", foreman: "F" }),
    ).rejects.toThrow("does not match any known employee");
  });

  it("existing row-based template still works unchanged alongside matrix detection", async () => {
    const csv = [
      "Employee ID,Date,Site,Foreman,Status,In Time,Out Time",
      "EMP-13,2026-11-05,South,Bob,Present,07:00,15:00",
    ].join("\n");
    const rows = await readAttendanceImport(csvFile(csv), employees, "2026-11");
    expect(rows[0]).toMatchObject({
      employeeId: 13,
      workDate: "2026-11-05",
      status: "PRESENT",
      inTime: "07:00",
      outTime: "15:00",
    });
  });
});
