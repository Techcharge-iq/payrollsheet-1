export interface PayrollAttendanceSnapshotEntry {
  [key: string]: string | number | null;
  employee_id: number;
  work_date: string;
  status: string;
  regular_hours: number;
  overtime_hours: number;
  site: string;
  project_id: string | null;
  foreman: string;
}

export interface PayrollAttendanceDiff {
  id: string;
  employeeId: number;
  workDate: string;
  field: "Record" | "Status" | "Hours" | "Site" | "Employee";
  oldValue: string;
  newValue: string;
  kind: "added" | "removed" | "changed" | "missing";
}

export function isPayrollAttendanceSnapshot(
  value: unknown,
): value is PayrollAttendanceSnapshotEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.employee_id === "number" &&
        typeof entry.work_date === "string" &&
        typeof entry.status === "string" &&
        typeof entry.regular_hours === "number" &&
        typeof entry.overtime_hours === "number" &&
        typeof entry.site === "string" &&
        (typeof entry.project_id === "string" || entry.project_id === null) &&
        typeof entry.foreman === "string",
    )
  );
}

function recordKey(entry: Pick<PayrollAttendanceSnapshotEntry, "employee_id" | "work_date">) {
  return `${entry.employee_id}:${entry.work_date}`;
}

function hoursValue(entry: PayrollAttendanceSnapshotEntry) {
  return entry.regular_hours + entry.overtime_hours;
}

function recordDescription(entry: PayrollAttendanceSnapshotEntry) {
  return `${entry.status} · ${hoursValue(entry)} hours · ${entry.site}`;
}

export function attendanceSnapshot(
  entries: readonly PayrollAttendanceSnapshotEntry[],
): PayrollAttendanceSnapshotEntry[] {
  return [...entries]
    .map((entry) => ({
      ...entry,
      regular_hours: Number(entry.regular_hours) || 0,
      overtime_hours: Number(entry.overtime_hours) || 0,
      site: entry.site.trim(),
    }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_id - b.employee_id);
}

export function diffPayrollAttendance(
  before: readonly PayrollAttendanceSnapshotEntry[],
  after: readonly PayrollAttendanceSnapshotEntry[],
  paidEmployeeIds: ReadonlySet<number>,
): PayrollAttendanceDiff[] {
  const oldRows = new Map(before.map((entry) => [recordKey(entry), entry]));
  const newRows = new Map(after.map((entry) => [recordKey(entry), entry]));
  const diffs: PayrollAttendanceDiff[] = [];

  for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
    const oldEntry = oldRows.get(key);
    const newEntry = newRows.get(key);
    const entry = newEntry ?? oldEntry!;
    if (!oldEntry) {
      diffs.push({
        id: `${key}:record`,
        employeeId: entry.employee_id,
        workDate: entry.work_date,
        field: "Record",
        oldValue: "No attendance record",
        newValue: recordDescription(entry),
        kind: "added",
      });
      continue;
    }
    if (!newEntry) {
      diffs.push({
        id: `${key}:record`,
        employeeId: entry.employee_id,
        workDate: entry.work_date,
        field: "Record",
        oldValue: recordDescription(entry),
        newValue: "Attendance record removed",
        kind: "removed",
      });
      continue;
    }
    if (oldEntry.status !== newEntry.status) {
      diffs.push({
        id: `${key}:status`,
        employeeId: entry.employee_id,
        workDate: entry.work_date,
        field: "Status",
        oldValue: oldEntry.status,
        newValue: newEntry.status,
        kind: "changed",
      });
    }
    if (hoursValue(oldEntry) !== hoursValue(newEntry)) {
      diffs.push({
        id: `${key}:hours`,
        employeeId: entry.employee_id,
        workDate: entry.work_date,
        field: "Hours",
        oldValue: String(hoursValue(oldEntry)),
        newValue: String(hoursValue(newEntry)),
        kind: "changed",
      });
    }
    if (oldEntry.site !== newEntry.site || oldEntry.project_id !== newEntry.project_id) {
      diffs.push({
        id: `${key}:site`,
        employeeId: entry.employee_id,
        workDate: entry.work_date,
        field: "Site",
        oldValue: oldEntry.site,
        newValue: newEntry.site,
        kind: "changed",
      });
    }
  }

  const newlyMissing = new Set(
    after
      .filter(
        (entry) =>
          (entry.status === "PRESENT" || entry.status === "HALF_DAY") &&
          hoursValue(entry) > 0 &&
          !paidEmployeeIds.has(entry.employee_id),
      )
      .map((entry) => entry.employee_id),
  );
  for (const employeeId of newlyMissing) {
    diffs.push({
      id: `missing:${employeeId}`,
      employeeId,
      workDate: "",
      field: "Employee",
      oldValue: "Not included in payroll",
      newValue: "Attendance recorded",
      kind: "missing",
    });
  }

  return diffs.sort(
    (a, b) =>
      a.employeeId - b.employeeId ||
      a.workDate.localeCompare(b.workDate) ||
      a.field.localeCompare(b.field),
  );
}

export function applySelectedAttendanceDiffs(
  before: readonly PayrollAttendanceSnapshotEntry[],
  current: readonly PayrollAttendanceSnapshotEntry[],
  diffs: readonly PayrollAttendanceDiff[],
  selectedIds: ReadonlySet<string>,
): PayrollAttendanceSnapshotEntry[] {
  const oldRows = new Map(before.map((entry) => [recordKey(entry), { ...entry }]));
  const newRows = new Map(current.map((entry) => [recordKey(entry), entry]));

  for (const diff of diffs) {
    if (!selectedIds.has(diff.id) || diff.kind === "missing") continue;
    const key = `${diff.employeeId}:${diff.workDate}`;
    if (diff.kind === "added") {
      const currentEntry = newRows.get(key);
      if (currentEntry) oldRows.set(key, { ...currentEntry });
      continue;
    }
    if (diff.kind === "removed") {
      oldRows.delete(key);
      continue;
    }

    const existing = oldRows.get(key);
    const currentEntry = newRows.get(key);
    if (!existing || !currentEntry) continue;
    if (diff.field === "Status") existing.status = currentEntry.status;
    if (diff.field === "Hours") {
      existing.regular_hours = currentEntry.regular_hours;
      existing.overtime_hours = currentEntry.overtime_hours;
    }
    if (diff.field === "Site") {
      existing.site = currentEntry.site;
      existing.project_id = currentEntry.project_id;
    }
  }

  return attendanceSnapshot([...oldRows.values()]);
}
