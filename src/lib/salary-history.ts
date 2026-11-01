export interface SalaryHistoryRecord {
  employee_id: number;
  hourly_rate: number;
  effective_from: string | null;
  created_at?: string;
}

/** Ignore undated legacy rows rather than inventing an effective salary date. */
export function effectiveRateOnDate(
  employeeId: number,
  workDate: string,
  history: SalaryHistoryRecord[],
) {
  return history
    .filter((record): record is SalaryHistoryRecord & { effective_from: string } =>
      record.employee_id === employeeId &&
      typeof record.effective_from === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.effective_from) &&
      record.effective_from <= workDate,
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) ||
      (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]?.hourly_rate;
}

export function effectiveRateForMonth(
  employeeId: number,
  month: string,
  history: SalaryHistoryRecord[],
) {
  return effectiveRateOnDate(employeeId, `${month}-31`, history);
}