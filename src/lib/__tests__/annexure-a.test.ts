import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  project: null as null | { id: string; name: string },
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string },
  filters: [] as Array<[string, string]>,
  employees: [{ id: 7, name: "Jabed" }] as Array<Record<string, unknown>>,
  ranges: [] as Array<[string, number, number]>,
  orders: [] as Array<[string, string, boolean]>,
  failAt: null as number | null,
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  dbAny: { from: (table: string) => {
    let start = 0;
    let end = 999;
    const result = () => ({
      data: table === "projects" ? mock.project : (table === "employees" ? mock.employees : mock.rows).slice(start, end + 1),
      error: table === "timesheets" ? mock.error ?? (mock.failAt === start ? { message: "page failed" } : null) : null,
    });
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { mock.filters.push([key, value]); return query; },
      gte: () => query,
      lte: () => query,
      order: (key: string, options: { ascending: boolean }) => { mock.orders.push([table, key, options.ascending]); return query; },
      range: (from: number, to: number) => { start = from; end = to; mock.ranges.push([table, from, to]); return query; },
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } },
}));
import { fetchAnnexureAData } from "../pdf/generateAnnexureA";

beforeEach(() => {
  mock.project = null; mock.rows = []; mock.error = null; mock.filters = [];
  mock.employees = [{ id: 7, name: "Jabed" }]; mock.ranges = []; mock.orders = []; mock.failAt = null;
});
describe("Annexure A site isolation", () => {
  it("excludes Seeb Phase 2 when Seeb is selected", async () => {
    mock.rows = [
      { employee_id: 7, site: " Seeb ", regular_hours: 8, status: "PRESENT" },
      { employee_id: 7, site: "Seeb Phase 2", regular_hours: 12, status: "PRESENT" },
    ];
    const data = await fetchAnnexureAData("Seeb", "2026-11");
    expect(data.grandTotalHours).toBe(8);
    expect(data.totalManDays).toBe(1);
    expect(mock.filters).toEqual([["name", "Seeb"]]);
  });
  it("uses project identity and excludes another project's identically named rows", async () => {
    const id = "00000000-0000-4000-8000-000000000010";
    mock.project = { id, name: "Seeb" };
    mock.rows = [
      { employee_id: 7, site: "Previous name", project_id: id, regular_hours: 8 },
      { employee_id: 7, site: "Seeb", project_id: "other-project", regular_hours: 12 },
      { employee_id: 7, site: "Seeb", project_id: null, regular_hours: 6 },
    ];
    expect((await fetchAnnexureAData(id, "2026-11")).grandTotalHours).toBe(14);
    expect(mock.filters).toEqual([["id", id]]);
  });
  it("requires a site instead of silently choosing the first", async () => {
    await expect(fetchAnnexureAData("", "2026-11")).rejects.toThrow("Select a site");
  });
  it("reports failed attendance reads rather than generating a misleading empty report", async () => {
    mock.error = { message: "permission denied" };
    await expect(fetchAnnexureAData("Seeb", "2026-11")).rejects.toThrow("Could not load attendance: permission denied");
  });
  it("includes selected-site workers and days beyond the first 1,000 company rows", async () => {
    mock.rows = [
      ...Array.from({ length: 1000 }, () => ({ employee_id: 9, site: "Seeb Phase 2", regular_hours: 12 })),
      ...Array.from({ length: 30 }, (_, day) => ({ employee_id: 7, site: "Seeb", regular_hours: 8, work_date: `2026-11-${String(day + 1).padStart(2, "0")}` })),
      { employee_id: 8, site: "Seeb", regular_hours: 6 },
    ];
    const data = await fetchAnnexureAData("Seeb", "2026-11");
    expect(data.totalWorkers).toBe(2);
    expect(data.totalManDays).toBe(31);
    expect(data.grandTotalHours).toBe(246);
    expect(data.workers.find(worker => worker.employeeId === 7)?.verifiedHours).toBe(240);
    expect(mock.ranges.filter(([table]) => table === "timesheets")).toEqual([["timesheets", 0, 999], ["timesheets", 1000, 1999]]);
    expect(mock.orders.filter(([table]) => table === "timesheets")).toEqual([["timesheets", "id", true], ["timesheets", "id", true]]);
  });
  it("checks the next page when attendance is exactly a full page", async () => {
    mock.rows = Array.from({ length: 1000 }, () => ({ employee_id: 7, site: "Seeb", regular_hours: 8 }));
    expect((await fetchAnnexureAData("Seeb", "2026-11")).grandTotalHours).toBe(8000);
    expect(mock.ranges).toContainEqual(["timesheets", 1000, 1999]);
  });
  it("rejects a later page failure instead of returning partial totals", async () => {
    mock.rows = Array.from({ length: 1000 }, () => ({ employee_id: 7, site: "Seeb", regular_hours: 8 }));
    mock.failAt = 1000;
    await expect(fetchAnnexureAData("Seeb", "2026-11")).rejects.toThrow("Could not load attendance: page failed");
  });
  it("resolves worker names and IDs beyond the first employee page", async () => {
    mock.employees = Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, name: `Worker ${index + 1}`, id_number: `ID-${index + 1}`, trade: "Electrician" }));
    mock.rows = [{ employee_id: 1001, site: "Seeb", regular_hours: 8 }];
    expect((await fetchAnnexureAData("Seeb", "2026-11")).workers[0]).toMatchObject({ name: "Worker 1001", civilId: "ID-1001", trade: "Electrician" });
    expect(mock.ranges).toContainEqual(["employees", 1000, 1999]);
  });
});