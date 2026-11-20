export interface PayrollScopeBatch {
  id: string;
  month: string;
  site: string;
}
export interface PayrollScopeLine {
  id?: string;
  batch_id: string;
  employee_id: number;
}

const normalize = (site: string) => site.trim().toLowerCase();
const allSites = (site: string) => ["", "multiple sites", "all sites"].includes(normalize(site));

/** Fresh server-side check; the database must still enforce concurrent writes. */
export function assertNoDuplicateSitePayroll(
  rows: PayrollScopeLine[],
  batches: PayrollScopeBatch[],
  existing: PayrollScopeLine[],
): void {
  const byId = new Map(batches.map((batch) => [batch.id, batch]));
  const pending = new Set<string>();
  const considered = [...existing];
  for (const row of rows) {
    const target = byId.get(row.batch_id);
    if (!target) throw new Error("The payroll batch was not found. Refresh and retry.");
    const original = row.id ? existing.find((line) => line.id === row.id) : undefined;
    if (row.id && !original) throw new Error("The existing payroll line was not found. Refresh and retry.");
    if (original && (original.batch_id !== row.batch_id || original.employee_id !== row.employee_id)) {
      throw new Error("Existing payroll lines cannot be moved to another batch or reassigned to another employee.");
    }
    const key = `${row.batch_id}:${row.employee_id}`;
    if (pending.has(key)) throw new Error("An employee is listed more than once in this payroll batch.");
    pending.add(key);
    for (const other of considered) {
      if (other.employee_id !== row.employee_id) continue;
      if (row.id && other.id === row.id) {
        if (other.batch_id !== row.batch_id) throw new Error("Existing payroll lines cannot be moved to another batch.");
        continue;
      }
      const batch = byId.get(other.batch_id);
      if (!batch || batch.month !== target.month) continue;
      if (other.batch_id === target.id || allSites(target.site) || allSites(batch.site) || normalize(batch.site) === normalize(target.site)) {
        throw new Error(`Employee ${row.employee_id} is already included in payroll for this site or an all-sites batch in ${target.month}. Open the existing batch instead.`);
      }
    }
    considered.push(row);
  }
}