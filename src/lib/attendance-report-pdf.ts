import { jsPDF } from "jspdf";
import { fmt, monthLabel } from "./payroll";
import type { TimesheetRecord } from "./payroll-data";
import type { Employee } from "./payroll";

export interface AttendanceReportMeta {
  month: string;
  subject: string;
}

function displayTime(value: string | null) {
  return value?.slice(0, 5) ?? "—";
}

function worked(entry: TimesheetRecord) {
  return entry.status === "PRESENT" || entry.status === "HALF_DAY";
}

function netHours(entry: TimesheetRecord) {
  return Number(entry.total_hours ?? Number(entry.regular_hours) + Number(entry.overtime_hours));
}

function filename(meta: AttendanceReportMeta) {
  const subject = meta.subject.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `attendance-${meta.month}-${subject || "report"}.pdf`.toLowerCase();
}

export function downloadAttendanceReport(
  rows: TimesheetRecord[],
  meta: AttendanceReportMeta,
  employees: Pick<Employee, "id" | "name">[],
) {
  if (!rows.length) return;
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const left = 10;
  const width = 277;
  const columns = [15, 35, 22, 38, 29, 19, 18, 18, 20, 20];
  const headers = [
    "Employee ID",
    "Employee",
    "Date",
    "Site",
    "Foreman",
    "Status",
    "In Time",
    "Out Time",
    "Break Hours",
    "Overtime Hours",
  ];
  const dark: [number, number, number] = [31, 56, 100];
  const writeLine = (values: string[], y: number, header = false) => {
    let x = left + 2;
    doc.setFont("helvetica", header ? "bold" : "normal");
    doc.setFontSize(header ? 7 : 6.5);
    values.forEach((value, index) => {
      const cellWidth = columns[index]!;
      doc.text(value.replaceAll("|", "/").slice(0, 32), x, y, { maxWidth: cellWidth - 2 });
      if (index < values.length - 1) doc.text("|", x + cellWidth - 1, y);
      x += cellWidth;
      if (index < values.length - 1) x += 2;
    });
  };

  doc.setFillColor(...dark);
  doc.rect(0, 0, 297, 25, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("ATTENDANCE REPORT", left, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${meta.subject}   |   ${monthLabel(meta.month)}`, left, 19);

  doc.setTextColor(35, 42, 50);
  doc.setFillColor(232, 236, 241);
  doc.rect(left, 31, width, 7, "F");
  writeLine(headers, 36, true);

  let y = 44;
  let hours = 0;
  let days = 0;
  rows.forEach((entry, index) => {
    if (y > 190) {
      doc.addPage();
      y = 18;
      doc.setFillColor(232, 236, 241);
      doc.rect(left, y - 5, width, 7, "F");
      writeLine(headers, y, true);
      y += 8;
    }
    if (index % 2 === 0) {
      doc.setFillColor(247, 248, 250);
      doc.rect(left, y - 4.5, width, 6, "F");
    }
    if (worked(entry)) {
      hours += netHours(entry);
      days += 1;
    }
    writeLine(
      [
        String(entry.employee_id),
        employeeNames.get(entry.employee_id) ?? "",
        entry.work_date,
        entry.site,
        entry.foreman,
        entry.status,
        displayTime(entry.in_time),
        displayTime(entry.out_time),
        fmt(Number(entry.break_hours)),
        fmt(Number(entry.overtime_hours)),
      ],
      y,
    );
    y += 6.5;
  });

  if (y > 190) {
    doc.addPage();
    y = 20;
  }
  doc.setDrawColor(191, 143, 0);
  doc.setLineWidth(0.5);
  doc.line(left, y, left + width, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(31, 56, 100);
  doc.setFontSize(9);
  doc.text(
    `Recorded entries: ${rows.length}   Days present: ${days}   Hours: ${fmt(hours)}`,
    left,
    y + 7,
  );
  doc.setTextColor(35, 42, 50);

  doc.save(filename(meta));
}
