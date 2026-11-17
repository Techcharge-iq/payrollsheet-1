import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  project: null as null | { id: string; name: string },
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string },
  filters: [] as Array<[string, string]>,
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  dbAny: { from: (table: string) => {
    const result = () => ({ data: table === "projects" ? mock.project : table === "employees" ? [{ id: 7, name: "Jabed" }] : mock.rows, error: table === "timesheets" ? mock.error : null });
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { mock.filters.push([key, value]); return query; },
      gte: () => query,
      lte: () => query,
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } },
}));
import { fetchAnnexureAData } from "../pdf/generateAnnexureA";

beforeEach(() => { mock.project = null; mock.rows = []; mock.error = null; mock.filters = []; });
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
});