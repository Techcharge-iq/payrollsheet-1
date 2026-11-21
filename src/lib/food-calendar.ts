import { sameSite, type SiteEntry } from "./multi-site-payroll";

export interface FoodDeployment {
  employee_id: number;
  site: string;
  effective_from: string;
  effective_to: string | null;
}

/** Existing zero food settings remain exemptions; positive legacy amounts enable daily food. */
export function monthlyCalendarFood(month: string, legacySetting: number): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Select a valid payroll month.");
  if (legacySetting <= 0) return 0;
  const [year = 0, monthNumber = 0] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** One charge per calendar day, irrespective of attendance status. Deployments take priority. */
export function calendarSiteFood(month: string, site: string, entries: SiteEntry[], deployments: FoodDeployment[], legacySetting: number): number {
  const monthly = monthlyCalendarFood(month, legacySetting);
  if (!monthly || ["", "all sites", "multiple sites"].includes(site.trim().toLowerCase())) return monthly;
  const dated = entries.filter((entry) => entry.site.trim() && entry.work_date.startsWith(`${month}-`))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.site.localeCompare(b.site));
  // Legacy manual payroll without attendance/deployment is still subject to the monthly cap.
  if (!dated.length && !deployments.length) return monthly;
  let days = 0;
  for (let day = 1; day <= monthly; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const deployment = deployments.filter((row) => row.effective_from <= date && (!row.effective_to || row.effective_to >= date))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.site.localeCompare(b.site))[0];
    const recorded = dated.find((entry) => entry.work_date === date);
    // Days left as "--" (no attendance, e.g. before joining) are not charged.
    if (dated.length && !recorded) continue;
    const previous = dated.filter((entry) => entry.work_date <= date).at(-1);
    const assignedSite = deployment?.site ?? recorded?.site ?? previous?.site ?? dated[0]?.site;
    if (assignedSite && sameSite(assignedSite, site)) days++;
  }
  return days;
}