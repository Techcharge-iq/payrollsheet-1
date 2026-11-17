import { useCallback, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Download,
  FileSpreadsheet,
  FileDown,
  Loader2,
  MapPin,
  Printer,
  Upload,
  Users,
} from "lucide-react";
import type { Employee } from "@/lib/payroll";
import { useBatches, useSaveTimesheets, useTimesheetsForMonth, type TimesheetRecord } from "@/lib/payroll-data";
import { currentPayrollMonth, fmt, monthLabel, payrollMonthOptions, toNum } from "@/lib/payroll";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  downloadAttendanceImportTemplate,
  readAttendanceImport,
  type AttendanceImportRecord,
} from "@/lib/attendance-import";
import { downloadAttendanceReport } from "@/lib/attendance-report-pdf";
import type { TablesInsert } from "@/integrations/supabase/external-types";
import { useProjects } from "@/lib/management-data";
import { exportAnnexureAPDF } from "@/lib/pdf/generateAnnexureA";
import { btnGold, btnOutline, card, select } from "./ui";
import { Button } from "@/components/ui/button";

interface Props {
  employees: Employee[];
}

interface AttendanceMatrixRow {
  id: number;
  name: string;
  trade: string;
  hours: number;
  present: number;
  absent: number;
  overtime: number;
  deductions: number;
}

function AttendanceMatrix({
  title,
  description,
  days,
  rows,
  entryByEmployeeDay,
  columnEntries,
  site,
}: {
  title: string;
  description: string;
  days: string[];
  rows: AttendanceMatrixRow[];
  entryByEmployeeDay: Map<string, TimesheetRecord>;
  columnEntries: TimesheetRecord[];
  site?: string | undefined;
}) {
  const columnTotals = days.map((date) => {
    const entries = columnEntries.filter((entry) => entry.work_date === date);
    return {
      present: entries.filter(isWorked).length,
      absent: entries.filter((entry) => entry.status === "ABSENT").length,
      overtime: entries.reduce((sum, entry) => sum + toNum(entry.overtime_hours), 0),
    };
  });
  const totals = rows.reduce(
    (result, row) => ({
      hours: result.hours + row.hours,
      present: result.present + row.present,
      absent: result.absent + row.absent,
      overtime: result.overtime + row.overtime,
      deductions: result.deductions + row.deductions,
    }),
    { hours: 0, present: 0, absent: 0, overtime: 0, deductions: 0 },
  );
  return (
    <div className={card + " attendance-report-matrix overflow-hidden"}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-bold text-navy">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No workers recorded for this report.
        </p>
      ) : (
        <TooltipProvider delayDuration={250}>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20 bg-navy-soft text-[10px] font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="sticky left-0 z-30 min-w-52 border-b border-r border-border bg-navy-soft px-3 py-2 text-left">
                    Name of staff
                  </th>
                  <th className="sticky left-52 z-30 min-w-14 border-b border-r border-border bg-navy-soft px-2 py-2 text-left">
                    Trade
                  </th>
                  {days.map((date) => (
                    <th
                      key={date}
                      className="min-w-11 border-b border-r border-border px-1 py-2 text-center"
                    >
                      {Number(date.slice(-2))}
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 min-w-20 border-b border-l border-border bg-navy-soft px-2 py-2 text-right">
                    Total hrs
                  </th>
                  <th className="min-w-16 border-b border-border px-2 py-2 text-right">Present</th>
                  <th className="min-w-16 border-b border-border px-2 py-2 text-right">Absent</th>
                  <th className="min-w-16 border-b border-border px-2 py-2 text-right">OT hrs</th>
                  <th className="min-w-20 border-b border-border px-2 py-2 text-right">
                    Deductions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th className="sticky left-0 z-10 min-w-52 border-b border-r border-border bg-background px-3 py-1.5 text-left font-medium text-slate-800">
                      {row.name}
                    </th>
                    <td className="sticky left-52 z-10 min-w-14 border-b border-r border-border bg-background px-2 py-1.5 text-slate-600">
                      {row.trade}
                    </td>
                    {days.map((date) => (
                      <td
                        key={date}
                        className="border-b border-r border-border px-0.5 py-1 text-center"
                      >
                        <AttendanceCell
                          date={date}
                          entry={entryByEmployeeDay.get(`${row.id}:${date}`)}
                          site={site}
                        />
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 border-b border-l border-border bg-background px-2 py-1.5 text-right font-bold text-navy">
                      {fmt(row.hours)}
                    </td>
                    <td className="border-b border-border px-2 py-1.5 text-right">{row.present}</td>
                    <td className="border-b border-border px-2 py-1.5 text-right">{row.absent}</td>
                    <td className="border-b border-border px-2 py-1.5 text-right">
                      {fmt(row.overtime)}
                    </td>
                    <td className="border-b border-border px-2 py-1.5 text-right">
                      {fmt(row.deductions)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy-soft/70 font-bold text-navy">
                  <th className="sticky left-0 z-10 border-r border-border px-3 py-2 text-left">
                    Total
                  </th>
                  <td className="sticky left-52 z-10 border-r border-border px-2 py-2 text-left">
                    —
                  </td>
                  {columnTotals.map((total, index) => (
                    <td
                      key={days[index]}
                      className="border-r border-border px-0.5 py-1 text-center text-[9px]"
                    >
                      <span className="block">
                        {total.present}P · {total.absent}A
                      </span>
                      <span className="block">OT {fmt(total.overtime)}</span>
                    </td>
                  ))}
                  <td className="border-l border-border px-2 py-2 text-right">
                    {fmt(totals.hours)}
                  </td>
                  <td className="px-2 py-2 text-right">{totals.present}</td>
                  <td className="px-2 py-2 text-right">{totals.absent}</td>
                  <td className="px-2 py-2 text-right">{fmt(totals.overtime)}</td>
                  <td className="px-2 py-2 text-right">{fmt(totals.deductions)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function isWorked(entry: TimesheetRecord) {
  return entry.status === "PRESENT" || entry.status === "HALF_DAY";
}

function isFriday(date: string) {
  return new Date(`${date}T00:00:00`).getDay() === 5;
}

function compactHours(hours: number) {
  return String(Number(hours.toFixed(3)));
}

function netHours(entry: TimesheetRecord) {
  return Number(entry.total_hours ?? Number(entry.regular_hours) + Number(entry.overtime_hours));
}

function AttendanceCell({
  date,
  entry,
  site,
}: {
  date: string;
  entry: TimesheetRecord | undefined;
  site?: string | undefined;
}) {
  const worked = entry ? isWorked(entry) : false;
  const isDifferentSite = Boolean(worked && site && entry && entry.site !== site);
  const label =
    entry?.status === "ABSENT"
      ? "A"
      : worked
        ? isDifferentSite
          ? "T"
          : entry
            ? compactHours(netHours(entry))
            : ""
        : entry?.status === "LEAVE"
          ? "L"
          : entry?.status === "HOLIDAY"
            ? "H"
            : isFriday(date)
              ? "F"
              : "";
  const cellStyle =
    label === "A"
      ? "bg-[#d98270] text-white"
      : label === "F"
        ? "bg-blue-500 text-white"
        : label === "T"
          ? "bg-amber-100 font-bold text-amber-900"
          : label === "L" || label === "H"
            ? "bg-slate-100 text-slate-600"
            : "text-slate-800";
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${dateLabel}: ${label || "no attendance recorded"}`}
          className={`inline-flex min-h-8 min-w-10 items-center justify-center rounded-sm px-1 text-xs ${cellStyle}`}
        >
          {label || "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56 space-y-1 text-left">
        <p className="font-semibold">{dateLabel}</p>
        {worked && entry ? (
          <>
            <p>{isDifferentSite ? `Worked at: ${entry.site}` : `Site: ${entry.site}`}</p>
            <p>
              Check-in: {entry.in_time?.slice(0, 5) ?? "—"} · Check-out:{" "}
              {entry.out_time?.slice(0, 5) ?? "—"}
            </p>
            <p>Break: {fmt(Number(entry.break_hours))} hrs</p>
            {!isDifferentSite && <p>Net hours: {compactHours(netHours(entry))}</p>}
          </>
        ) : (
          <p>
            {entry?.status === "ABSENT"
              ? "Absent"
              : entry?.status === "LEAVE"
                ? "Leave"
                : entry?.status === "HOLIDAY"
                  ? "Holiday"
                  : label === "F"
                    ? "Friday"
                    : "No attendance recorded"}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function AttendanceReportTab({ employees }: Props) {
  const [filter, setFilter] = useState<"staff" | "site">("staff");
  const [month, setMonth] = useState(currentPayrollMonth);
  const [employeeId, setEmployeeId] = useState("");
  const [site, setSite] = useState("");
  const [defaultSite, setDefaultSite] = useState("");
  const [defaultForeman, setDefaultForeman] = useState("");
  const [importRows, setImportRows] = useState<AttendanceImportRecord[]>([]);
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const saveTimesheets = useSaveTimesheets();
  const [exportingAnnexureA, setExportingAnnexureA] = useState(false);
  const [annexureError, setAnnexureError] = useState("");
  const timesheetsQuery = useTimesheetsForMonth(month);
  const batchesQuery = useBatches(month);
  const projectsQuery = useProjects(true);
  const timesheets = useMemo(() => timesheetsQuery.data ?? [], [timesheetsQuery.data]);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const loading = timesheetsQuery.isLoading || batchesQuery.isLoading || projectsQuery.isLoading;
  const queryError = timesheetsQuery.error ?? batchesQuery.error ?? projectsQuery.error;
  const error = queryError instanceof Error ? queryError.message : "";

  const sites = useMemo(
    () =>
      [
        ...new Set(
          [
            ...projects.map((project) => project.name.trim()),
            ...timesheets.map((entry) => entry.site.trim()),
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [projects, timesheets],
  );
  const monthOptions = useMemo(
    () =>
      [
        ...new Set([
          ...payrollMonthOptions(),
          ...timesheets.map((entry) => entry.work_date.slice(0, 7)),
        ]),
      ].sort(),
    [timesheets],
  );
  const reportRows = useMemo(
    () => timesheets.filter((entry) => entry.work_date.startsWith(`${month}-`)),
    [timesheets, month],
  );
  const selectedEmployee = employees.find((employee) => String(employee.id) === employeeId);
  const employeeRows = reportRows
    .filter((entry) => String(entry.employee_id) === employeeId)
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
  const payrollBatches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const employeeDeductions = useCallback(
    (id: number) =>
      payrollBatches
        .flatMap((batch) => batch.lines)
        .filter((line) => Number(line.employee_id) === id)
        .reduce(
          (sum, line) =>
            sum +
            toNum(line.food_deduction) +
            toNum(line.prev_advance) +
            toNum(line.other_deduction),
          0,
        ),
    [payrollBatches],
  );
  const daysInMonth = month
    ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    : 0;
  const reportDays = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
  const entryByEmployeeDay = useMemo(
    () => new Map(reportRows.map((entry) => [`${entry.employee_id}:${entry.work_date}`, entry])),
    [reportRows],
  );

  const siteRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        employee: Employee | undefined;
        days: number;
        hours: number;
        present: number;
        absent: number;
        overtime: number;
        deductions: number;
      }
    >();
    reportRows
      .filter((entry) => entry.site === site)
      .forEach((entry) => {
        const current = grouped.get(entry.employee_id) ?? {
          employee: employees.find((employee) => employee.id === entry.employee_id),
          days: 0,
          hours: 0,
          present: 0,
          absent: 0,
          overtime: 0,
          deductions: employeeDeductions(entry.employee_id),
        };
        if (isWorked(entry)) {
          current.days += 1;
          current.hours += netHours(entry);
        }
        if (isWorked(entry)) current.present += 1;
        if (entry.status === "ABSENT") current.absent += 1;
        current.overtime += toNum(entry.overtime_hours);
        grouped.set(entry.employee_id, current);
      });
    return [...grouped.entries()]
      .map(([id, summary]) => ({ id, ...summary }))
      .sort((a, b) => (a.employee?.name ?? "").localeCompare(b.employee?.name ?? ""));
  }, [employeeDeductions, employees, reportRows, site]);

  const siteTotals = siteRows.reduce(
    (totals, worker) => ({
      days: totals.days + worker.days,
      hours: totals.hours + worker.hours,
      present: totals.present + worker.present,
      absent: totals.absent + worker.absent,
      overtime: totals.overtime + worker.overtime,
      deductions: totals.deductions + worker.deductions,
    }),
    { days: 0, hours: 0, present: 0, absent: 0, overtime: 0, deductions: 0 },
  );
  const exportRows =
    filter === "staff" ? employeeRows : reportRows.filter((entry) => entry.site === site);
  const existingImportCount = importRows.filter((row) =>
    entryByEmployeeDay.has(`${row.employeeId}:${row.workDate}`),
  ).length;

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) return;
    setImportError("");
    setImportRows([]);
    setIsImporting(true);
    try {
      const rows = await readAttendanceImport(file, employees, month, {
        site: filter === "site" ? site : defaultSite,
        foreman: defaultForeman,
      });
      setImportRows(rows);
    } catch (caughtError) {
      setImportError(
        caughtError instanceof Error ? caughtError.message : "Could not read the attendance file.",
      );
    } finally {
      setIsImporting(false);
      inputElement.value = "";
    }
  };

  const saveImportedRows = async () => {
    if (!importRows.length) return;
    if (
      existingImportCount > 0 &&
      !window.confirm(
        `${existingImportCount} existing employee-day record(s) will be replaced. Continue?`,
      )
    ) {
      return;
    }
    setIsSavingImport(true);
    try {
      const payload: TablesInsert<"timesheets">[] = importRows.map((row) => ({
        employee_id: row.employeeId,
        work_date: row.workDate,
        site: row.site,
        foreman: row.foreman,
        project_id: null,
        foreman_user_id: null,
        status: row.status,
        in_time: row.inTime,
        out_time: row.outTime,
        break_hours: row.breakHours,
        overtime_hours: row.overtimeHours,
        remarks: "Imported from monthly attendance file",
      }));
      await saveTimesheets.mutateAsync(payload);
      setImportRows([]);
      setImportError("");
    } catch (caughtError) {
      setImportError(
        caughtError instanceof Error ? caughtError.message : "Could not save imported attendance.",
      );
    } finally {
      setIsSavingImport(false);
    }
  };
  const staffTotals = employeeRows.reduce(
    (totals, entry) => ({
      days: totals.days + (isWorked(entry) ? 1 : 0),
      hours: totals.hours + (isWorked(entry) ? netHours(entry) : 0),
      present: totals.present + (isWorked(entry) ? 1 : 0),
      absent: totals.absent + (entry.status === "ABSENT" ? 1 : 0),
      overtime: totals.overtime + toNum(entry.overtime_hours),
    }),
    { days: 0, hours: 0, present: 0, absent: 0, overtime: 0 },
  );
  const selectedDeductions = selectedEmployee ? employeeDeductions(selectedEmployee.id) : 0;

  return (
    <section className="attendance-report-print space-y-4">
      <header className={card + " no-print flex items-center gap-3 p-4"}>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
          <CalendarDays size={20} />
        </div>
        <div>
          <h2 className="font-display text-lg font-extrabold text-navy">Attendance report</h2>
          <p className="text-xs text-muted-foreground">
            Review monthly hours by employee or work site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className={`no-print ml-auto ${btnOutline}`}
        >
          <Printer size={16} />
          Print Report
        </button>
        <button
          type="button"
          onClick={() =>
            downloadAttendanceReport(
              exportRows,
              {
                month,
                subject: filter === "staff" ? (selectedEmployee?.name ?? "Employee") : site,
              },
              employees,
            )
          }
          disabled={
            (!selectedEmployee && filter === "staff") ||
            (!site && filter === "site") ||
            !exportRows.length
          }
          className={`no-print ${btnOutline}`}
        >
          <Download size={16} />
          Download PDF
        </button>
        <div className="no-print ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={async () => {
              if (filter !== "site" || !site) return;
              setAnnexureError("");
              setExportingAnnexureA(true);
              try {
                await exportAnnexureAPDF(site, month);
              } catch (err) {
                setAnnexureError(err instanceof Error ? err.message : "Could not export Annexure A. Please retry.");
              } finally {
                setExportingAnnexureA(false);
              }
            }}
            disabled={exportingAnnexureA || loading || filter !== "site" || !site}
            className={`${btnGold} text-xs`}
            title="Download verified Annexure A PDF for site performance audit"
          >
            {exportingAnnexureA ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Generating Annexure A…
              </>
            ) : (
              <>
                <FileDown size={15} />
                Export Annexure A (PDF)
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={() => window.print()}
            className={btnOutline}
          >
            <Printer size={16} />
            Print Report
          </button>
        </div>
      </header>
      {annexureError && <p role="alert" className="no-print text-sm text-danger">{annexureError}</p>}

      <div className={card + " no-print space-y-4 p-4"}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Report filter">
          <button
            type="button"
            onClick={() => setFilter("staff")}
            aria-pressed={filter === "staff"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              filter === "staff" ? "bg-navy text-white" : "border border-border text-slate-600"
            }`}
          >
            Filter by staff
          </button>
          <button
            type="button"
            onClick={() => setFilter("site")}
            aria-pressed={filter === "site"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              filter === "site" ? "bg-navy text-white" : "border border-border text-slate-600"
            }`}
          >
            Filter by site
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {filter === "staff" ? (
            <label className="text-xs font-semibold text-slate-600">
              Employee
              <select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                className={select + " mt-1"}
              >
                <option value="">Select employee…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} — ID {employee.id_number || employee.id} — {employee.trade}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-xs font-semibold text-slate-600">
              Site
              <select
                value={site}
                onChange={(event) => setSite(event.target.value)}
                className={select + " mt-1"}
              >
                <option value="">Select site…</option>
                {sites.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-slate-600">
            Month
            <select
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setImportRows([]);
                setImportError("");
                setSite("");
              }}
              className={select + " mt-1"}
            >
              {monthOptions.map((option) => (
                <option key={option} value={option}>
                  {monthLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={card + " no-print space-y-3 p-4"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-navy">Import monthly attendance</h3>
            <p className="text-xs text-muted-foreground">
              Upload a PDF exported from this report, .xlsx, or .csv. Review every row before
              saving.
            </p>
          </div>
          <button type="button" onClick={downloadAttendanceImportTemplate} className={btnOutline}>
            <FileSpreadsheet size={15} /> Download template
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">
            Default site
            <input
              value={filter === "site" && site ? site : defaultSite}
              onChange={(event) => setDefaultSite(event.target.value)}
              className={select + " mt-1"}
              placeholder="Used when the file has no site column"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Default foreman
            <input
              value={defaultForeman}
              onChange={(event) => setDefaultForeman(event.target.value)}
              className={select + " mt-1"}
              placeholder="Used when the file has no foreman column"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 self-end rounded-lg border border-border px-3 py-2 text-sm font-bold text-navy hover:bg-navy-soft">
            <input
              type="file"
              accept=".pdf,.xlsx,.csv,application/pdf"
              className="sr-only"
              onChange={handleImportFile}
              disabled={isImporting || isSavingImport}
            />
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isImporting ? "Reading file…" : "Choose attendance file"}
          </label>
        </div>
        {importError && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger"
          >
            {importError}
          </p>
        )}
        {importRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                {importRows.length} row(s) ready
                {existingImportCount
                  ? ` · ${existingImportCount} will replace existing records`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => void saveImportedRows()}
                disabled={isSavingImport}
                className={btnOutline}
              >
                {isSavingImport ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                {isSavingImport ? "Saving…" : "Save attendance"}
              </button>
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    {[
                      "Employee",
                      "Date",
                      "Site",
                      "Foreman",
                      "Status",
                      "In",
                      "Out",
                      "Break",
                      "OT",
                    ].map((heading) => (
                      <th key={heading} className="px-2 py-2 font-bold">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row) => (
                    <tr
                      key={`${row.employeeId}:${row.workDate}`}
                      className="border-t border-border"
                    >
                      <td className="px-2 py-1.5">{row.employeeName}</td>
                      <td className="px-2 py-1.5">{row.workDate}</td>
                      <td className="px-2 py-1.5">{row.site}</td>
                      <td className="px-2 py-1.5">{row.foreman}</td>
                      <td className="px-2 py-1.5">{row.status}</td>
                      <td className="px-2 py-1.5">{row.inTime ?? "—"}</td>
                      <td className="px-2 py-1.5">{row.outTime ?? "—"}</td>
                      <td className="px-2 py-1.5">{row.breakHours}</td>
                      <td className="px-2 py-1.5">{row.overtimeHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
          Loading attendance report…
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : filter === "staff" ? (
        !selectedEmployee ? (
          <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
            Select an employee to view their monthly attendance.
          </div>
        ) : (
          <>
            <h2 className="attendance-report-print-only">
              Attendance Report · {selectedEmployee.name} · {monthLabel(month)}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Employee", value: selectedEmployee.name, icon: Users },
                { label: "Total present", value: staffTotals.present, icon: CalendarDays },
                { label: "Total absent", value: staffTotals.absent, icon: Users },
                { label: "Hours logged", value: fmt(staffTotals.hours), icon: Clock3 },
                { label: "OT hours", value: fmt(staffTotals.overtime), icon: Clock3 },
                {
                  label: "Deductions (month, all sites)",
                  value: fmt(selectedDeductions),
                  icon: MapPin,
                },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className={card + " flex min-w-0 items-center gap-3 p-3"}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-navy">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="truncate text-sm font-extrabold text-navy">{value}</p>
                  </div>
                </div>
              ))}
            </div>
            <AttendanceMatrix
              title={`${selectedEmployee.name} · ${monthLabel(month)}`}
              description="Daily net hours. Deductions show the payroll-month total across all sites; hover or focus a cell for shift details."
              days={reportDays}
              rows={[
                {
                  id: selectedEmployee.id,
                  name: selectedEmployee.name,
                  trade: selectedEmployee.trade,
                  hours: staffTotals.hours,
                  present: staffTotals.present,
                  absent: staffTotals.absent,
                  overtime: staffTotals.overtime,
                  deductions: selectedDeductions,
                },
              ]}
              entryByEmployeeDay={entryByEmployeeDay}
              columnEntries={employeeRows}
            />
          </>
        )
      ) : !site ? (
        <div className={card + " p-8 text-center text-sm text-muted-foreground"}>
          Select a site to view its monthly workforce summary.
        </div>
      ) : (
        <>
          <h2 className="attendance-report-print-only">
            Attendance Report · {site} · {monthLabel(month)}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Workers", value: siteRows.length, icon: Users },
              { label: "Total present", value: siteTotals.present, icon: CalendarDays },
              { label: "Total absent", value: siteTotals.absent, icon: Users },
              { label: "Hours contributed", value: fmt(siteTotals.hours), icon: Clock3 },
              { label: "OT hours", value: fmt(siteTotals.overtime), icon: Clock3 },
              {
                label: "Deductions (month, all sites)",
                value: fmt(siteTotals.deductions),
                icon: MapPin,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className={card + " min-w-0 p-3"}>
                <div className="flex items-center gap-2 text-navy">
                  <Icon size={16} />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </span>
                </div>
                <p className="mt-2 truncate font-display text-lg font-extrabold text-navy">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <AttendanceMatrix
            title={`${monthLabel(month)} · ${site}`}
            description="T means the employee worked at another site. Deductions show each employee’s payroll-month total across all sites."
            days={reportDays}
            rows={siteRows.map((worker) => ({
              id: worker.id,
              name: worker.employee?.name ?? "Former employee",
              trade: worker.employee?.trade ?? "—",
              hours: worker.hours,
              present: worker.present,
              absent: worker.absent,
              overtime: worker.overtime,
              deductions: worker.deductions,
            }))}
            entryByEmployeeDay={entryByEmployeeDay}
            columnEntries={reportRows.filter((entry) => entry.site === site)}
            site={site}
          />
        </>
      )}
    </section>
  );
}
