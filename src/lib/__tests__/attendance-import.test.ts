import { describe, expect, it } from "vitest";
import { readAttendanceImport } from "../attendance-import";

const employees = [
  { id: 12, name: "Sam Worker", id_number: "EMP-12" },
  { id: 13, name: "Lee Worker", id_number: "EMP-13" },
];

function csvFile(contents: string) {
  return new File([contents], "attendance.csv", { type: "text/csv" });
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
