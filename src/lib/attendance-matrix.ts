/**
 * Monthly attendance matrix format parser.
 *
 * Header row: "Name of staff" | "Trade" | 1 | 2 | ... | 31 | "Total Hours"
 * Cell values:
 *   "A"       → ABSENT
 *   "F"       → WEEKLY_OFF (Friday)
 *   "H"/"HD"  → HALF_DAY
 *   "L"       → LEAVE
 *   "PH"/"HOLIDAY" → HOLIDAY
 *   numeric   → PRESENT (worked hours), 0 → ABSENT
 *   blank     → no record generated (not-joined leading / left trailing / gap)
 */

import type { AttendanceImportEmployee, AttendanceImportRecord, AttendanceImportStatus } from "./attendance-import";

export type { AttendanceImportEmployee, AttendanceImportRecord, AttendanceImportStatus };

export interface MatrixDefaults {
  site?: string;
  foreman?: string;
}

/** Returns true if a header row looks like a monthly matrix (Name of staff + day numbers 1-31). */
export function isMatrixHeader(row: string[]): boolean {
  const cells = row.map((c) => c.trim().toLowerCase());
  if (!cells.some((c) => c === "name of staff" || c === "nameofstaff")) return false;
  const dayCount = cells.filter((c) => /^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 31).length;
  return dayCount >= 7; // at least one full week of day columns must be present
}

/** Days in a given YYYY-MM month. */
function daysInMonth(year: number, month: number): number {
  // month is 1-based; Date constructor with day=0 gives last day of prior month
  return new Date(year, month, 0).getDate();
}

/** Parse the raw 2-D cell grid as a monthly matrix and return attendance records. */
export function recordsFromMatrix(
  rawRows: string[][],
  employees: AttendanceImportEmployee[],
  month: string, // YYYY-MM
  defaults: MatrixDefaults = {},
): AttendanceImportRecord[] {
  // Find the header row
  const headerRowIndex = rawRows.findIndex(isMatrixHeader);
  if (headerRowIndex < 0) {
    throw new Error(
      'The matrix sheet must have a header row containing "Name of staff" and day columns 1–31.',
    );
  }

  const headerRow = rawRows[headerRowIndex]!.map((c) => c.trim());
  const parts = month.split("-");
  const year = Number(parts[0]);
  const monthNum = Number(parts[1]);
  const maxDay = daysInMonth(year, monthNum);

  // Map column index → day number (1-based) for valid day columns within this month
  const dayCols = new Map<number, number>(); // colIdx → day
  headerRow.forEach((cell, colIdx) => {
    const n = Number(cell);
    if (/^\d{1,2}$/.test(cell) && n >= 1 && n <= maxDay) {
      dayCols.set(colIdx, n);
    }
  });

  if (dayCols.size === 0) {
    throw new Error(
      `The matrix header has no valid day columns for ${month} (expected 1–${maxDay}).`,
    );
  }

  // Find name column
  const nameColIdx = headerRow.findIndex(
    (c) => c.toLowerCase() === "name of staff" || c.toLowerCase() === "nameofstaff",
  );
  if (nameColIdx < 0) throw new Error('Matrix header missing "Name of staff" column.');

  const site = defaults.site?.trim() ?? "";
  const foreman = defaults.foreman?.trim() ?? "";

  const records: AttendanceImportRecord[] = [];
  const seen = new Set<string>(); // `${empId}:${date}`

  // Sort day columns by day number for deterministic processing
  const daySortedCols = [...dayCols.entries()].sort((a, b) => a[1] - b[1]); // [colIdx, day]

  const dataRows = rawRows.slice(headerRowIndex + 1);
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]!;
    const rawName = (row[nameColIdx] ?? "").trim();
    if (!rawName) continue; // blank name row = skip

    // Skip obvious totals/summary rows
    const lowerName = rawName.toLowerCase();
    if (lowerName === "total" || lowerName === "totals" || lowerName === "grand total") continue;

    // Match employee by name (case-insensitive)
    const empMatches = employees.filter(
      (e) => e.name.trim().toLowerCase() === lowerName,
    );
    const lineLabel = `Matrix row ${headerRowIndex + rowIdx + 2}`;
    if (empMatches.length === 0) {
      throw new Error(`${lineLabel}: employee "${rawName}" does not match any known employee.`);
    }
    if (empMatches.length > 1) {
      throw new Error(`${lineLabel}: employee name "${rawName}" matches more than one employee.`);
    }
    const employee = empMatches[0]!;

    // Determine the first and last non-blank day to identify leading/trailing blanks
    let firstNonBlank = Infinity;
    let lastNonBlank = -Infinity;
    for (const [colIdx, day] of daySortedCols) {
      const raw = (row[colIdx] ?? "").trim();
      if (raw !== "") {
        if (day < firstNonBlank) firstNonBlank = day;
        if (day > lastNonBlank) lastNonBlank = day;
      }
    }

    // If no non-blank cell at all, skip this employee row entirely
    if (firstNonBlank === Infinity) continue;

    for (const [colIdx, day] of daySortedCols) {
      const raw = (row[colIdx] ?? "").trim();

      // Blank cells at any position (before first, after last, or between) are skipped — no record
      if (raw === "") continue;

      const upper = raw.toUpperCase();
      let status: AttendanceImportStatus;
      let workedHours = 0;

      if (upper === "A") {
        status = "ABSENT";
      } else if (upper === "F") {
        status = "WEEKLY_OFF";
      } else if (upper === "H" || upper === "HD") {
        status = "HALF_DAY";
        workedHours = 4;
      } else if (upper === "L") {
        status = "LEAVE";
      } else if (upper === "PH" || upper === "HOLIDAY") {
        status = "HOLIDAY";
      } else {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 24) {
          throw new Error(
            `${lineLabel}, day ${day}: cell "${raw}" is not a recognised value ` +
            `(A, F, H, HD, L, PH, numeric hours 0-24, or blank).`,
          );
        }
        status = numeric > 0 ? "PRESENT" : "ABSENT";
        workedHours = numeric;
      }

      const paddedDay = String(day).padStart(2, "0");
      const workDate = `${month}-${paddedDay}`;
      const key = `${employee.id}:${workDate}`;
      if (seen.has(key)) continue; // duplicate day column — skip
      seen.add(key);

      let inTime: string | null = null;
      let outTime: string | null = null;
      if ((status === "PRESENT" || status === "HALF_DAY") && workedHours > 0) {
        inTime = "06:00";
        const outMinutes = 360 + Math.round(workedHours * 60);
        outTime = `${String(Math.floor(outMinutes / 60)).padStart(2, "0")}:${String(outMinutes % 60).padStart(2, "0")}`;
      }

      records.push({
        employeeId: employee.id,
        employeeName: employee.name,
        workDate,
        site,
        foreman,
        status,
        inTime,
        outTime,
        breakHours: 0,
        overtimeHours: 0,
      });
    }
  }

  if (records.length === 0) {
    throw new Error(
      "The matrix sheet contained no attendance records. " +
      "Check that employee names match and day columns contain values.",
    );
  }
  return records;
}
