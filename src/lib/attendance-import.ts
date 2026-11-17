import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readPayrollImport, type PayrollImportRow } from "./payroll-excel";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 40;

export type AttendanceImportStatus =
  "PRESENT" | "HALF_DAY" | "ABSENT" | "LEAVE" | "HOLIDAY" | "WEEKLY_OFF";

export interface AttendanceImportEmployee {
  id: number;
  name: string;
  id_number?: string | null;
}

export interface AttendanceImportRecord {
  employeeId: number;
  employeeName: string;
  workDate: string;
  site: string;
  foreman: string;
  status: AttendanceImportStatus;
  inTime: string | null;
  outTime: string | null;
  breakHours: number;
  overtimeHours: number;
}

export interface AttendanceImportDefaults {
  site?: string;
  foreman?: string;
}

function normalized(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parsePdfLines(lines: string[]): PayrollImportRow[] {
  const rows = lines.flatMap((line, index) => {
    if (!line.includes("|")) return [];
    return [{ rowNumber: index + 1, cells: line.split("|").map((cell) => cell.trim()) }];
  });
  const headerIndex = rows.findIndex(({ cells }) => {
    const headers = cells.map(normalized);
    return (
      headers.some((header) => ["employeeid", "empid", "employee", "name"].includes(header)) &&
      headers.some((header) => ["date", "workdate"].includes(header))
    );
  });
  if (headerIndex < 0) {
    throw new Error(
      "The PDF does not contain a supported attendance table. Use a text-based PDF with columns separated by vertical bars, or import an .xlsx/.csv file.",
    );
  }

  const headers = rows[headerIndex]!.cells.map(normalized);
  return rows.slice(headerIndex + 1).flatMap(({ rowNumber, cells }) => {
    if (!cells.some(Boolean)) return [];
    return [
      {
        rowNumber,
        values: Object.fromEntries(
          headers.flatMap((header, index) => (header ? [[header, cells[index] ?? ""]] : [])),
        ),
      },
    ];
  });
}

async function readPdfImport(file: File): Promise<PayrollImportRow[]> {
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`The PDF exceeds the ${MAX_PDF_PAGES} page import limit.`);
    }
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lineMap = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = item.transform[4] ?? 0;
        const y = Math.round((item.transform[5] ?? 0) / 2) * 2;
        const line = lineMap.get(y) ?? [];
        line.push({ x, text: item.str });
        lineMap.set(y, line);
      }
      for (const [, items] of [...lineMap].sort(([first], [second]) => second - first)) {
        lines.push(
          items
            .sort((first, second) => first.x - second.x)
            .map(({ text }) => text)
            .join(" "),
        );
      }
    }
    return parsePdfLines(lines);
  } finally {
    await loadingTask.destroy();
  }
}

function column(values: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = values[name];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function parseStatus(value: string, rowNumber: number): AttendanceImportStatus {
  const status = normalized(value);
  const statuses: Record<string, AttendanceImportStatus> = {
    present: "PRESENT",
    p: "PRESENT",
    halfday: "HALF_DAY",
    h: "HALF_DAY",
    absent: "ABSENT",
    a: "ABSENT",
    leave: "LEAVE",
    l: "LEAVE",
    holiday: "HOLIDAY",
    weeklyoff: "WEEKLY_OFF",
    off: "WEEKLY_OFF",
  };
  const parsed = statuses[status];
  if (!parsed)
    throw new Error(
      `Row ${rowNumber}: use Present, Half day, Absent, Leave, Holiday, or Weekly off.`,
    );
  return parsed;
}

function parseDate(value: string, month: string, rowNumber: number) {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Row ${rowNumber}: date must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Row ${rowNumber}: enter a valid calendar date.`);
  }
  if (!date.startsWith(`${month}-`)) {
    throw new Error(`Row ${rowNumber}: date must be in the selected month (${month}).`);
  }
  return date;
}

function parseHours(value: string, label: string, rowNumber: number) {
  if (!value) return 0;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    throw new Error(`Row ${rowNumber}: ${label} must be a number from 0 to 24.`);
  }
  return hours;
}

function parseTime(value: string, label: string, rowNumber: number) {
  if (!value) return null;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new Error(`Row ${rowNumber}: ${label} must use 24-hour HH:MM format.`);
  }
  return value.slice(0, 5);
}

function employeeForRow(
  values: Record<string, string>,
  employees: AttendanceImportEmployee[],
  rowNumber: number,
) {
  const identifier = column(values, "employeeid", "empid", "id", "databaseid");
  const name = column(values, "employee", "employeename", "name");
  const matches = employees.filter((employee) => {
    if (identifier && [String(employee.id), employee.id_number ?? ""].includes(identifier))
      return true;
    return Boolean(name && employee.name.trim().toLowerCase() === name.toLowerCase());
  });
  if (matches.length !== 1) {
    throw new Error(
      `Row ${rowNumber}: employee ${identifier || name ? `"${identifier || name}"` : "is missing"} does not match exactly one employee.`,
    );
  }
  return matches[0]!;
}

function recordsFromRows(
  rows: PayrollImportRow[],
  employees: AttendanceImportEmployee[],
  month: string,
  defaults: AttendanceImportDefaults,
): AttendanceImportRecord[] {
  if (!rows.length) throw new Error("The file contains no attendance rows.");
  const dates = new Set<string>();
  return rows.map(({ rowNumber, values }) => {
    const employee = employeeForRow(values, employees, rowNumber);
    const workDate = parseDate(column(values, "date", "workdate"), month, rowNumber);
    const key = `${employee.id}:${workDate}`;
    if (dates.has(key))
      throw new Error(`Row ${rowNumber}: this employee has more than one entry for ${workDate}.`);
    dates.add(key);

    const status = parseStatus(column(values, "status", "attendance"), rowNumber);
    const site = column(values, "site", "project") || defaults.site?.trim() || "";
    const foreman = column(values, "foreman", "supervisor") || defaults.foreman?.trim() || "";
    if (!site || !foreman) {
      throw new Error(
        `Row ${rowNumber}: site and foreman are required (include columns or set import defaults).`,
      );
    }

    const breakHours = parseHours(column(values, "breakhours", "break"), "break hours", rowNumber);
    const overtimeHours = parseHours(
      column(values, "overtimehours", "overtime", "ot"),
      "overtime hours",
      rowNumber,
    );
    let inTime = parseTime(column(values, "intime", "checkin", "in"), "in time", rowNumber);
    let outTime = parseTime(column(values, "outtime", "checkout", "out"), "out time", rowNumber);

    if (status === "PRESENT" || status === "HALF_DAY") {
      if (!inTime && !outTime) {
        const regularHours = parseHours(
          column(values, "regularhours", "regular", "hours"),
          "hours",
          rowNumber,
        );
        const durationMinutes = Math.round((regularHours + overtimeHours + breakHours) * 60);
        if (durationMinutes <= 0 || durationMinutes >= 24 * 60) {
          throw new Error(
            `Row ${rowNumber}: worked entries need a positive shift shorter than 24 hours.`,
          );
        }
        inTime = "06:00";
        const outMinutes = 360 + durationMinutes;
        outTime = `${String(Math.floor(outMinutes / 60)).padStart(2, "0")}:${String(outMinutes % 60).padStart(2, "0")}`;
      }
      if (!inTime || !outTime || outTime <= inTime) {
        throw new Error(
          `Row ${rowNumber}: worked entries need valid in and out times on the same day.`,
        );
      }
      const duration =
        (Number(outTime.slice(0, 2)) * 60 +
          Number(outTime.slice(3, 5)) -
          Number(inTime.slice(0, 2)) * 60 -
          Number(inTime.slice(3, 5))) /
        60;
      if (breakHours > duration || overtimeHours > duration - breakHours) {
        throw new Error(`Row ${rowNumber}: break and overtime cannot exceed the shift duration.`);
      }
    } else {
      if (overtimeHours > 0)
        throw new Error(`Row ${rowNumber}: non-worked entries cannot include overtime.`);
      inTime = null;
      outTime = null;
    }

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      workDate,
      site,
      foreman,
      status,
      inTime,
      outTime,
      breakHours,
      overtimeHours,
    };
  });
}

export async function readAttendanceImport(
  file: File,
  employees: AttendanceImportEmployee[],
  month: string,
  defaults: AttendanceImportDefaults = {},
): Promise<AttendanceImportRecord[]> {
  if (file.size > MAX_IMPORT_SIZE) {
    throw new Error("The file is larger than 10 MB. Please split it into smaller files.");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Select a valid attendance month.");

  const extension = file.name.split(".").pop()?.toLowerCase();
  const rows =
    extension === "pdf"
      ? await readPdfImport(file)
      : extension === "xlsx" || extension === "csv"
        ? await readPayrollImport(file)
        : null;
  if (!rows) throw new Error("Choose a text-based .pdf, .xlsx workbook, or .csv file.");
  return recordsFromRows(rows, employees, month, defaults);
}

export function downloadAttendanceImportTemplate() {
  const headers = [
    "Employee ID",
    "Date",
    "Site",
    "Foreman",
    "Status",
    "In Time",
    "Out Time",
    "Break Hours",
    "Overtime Hours",
  ];
  const csv = `${headers.map((header) => `"${header}"`).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "attendance-import-template.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
