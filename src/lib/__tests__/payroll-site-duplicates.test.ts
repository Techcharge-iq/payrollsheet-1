import { describe, expect, it } from "vitest";
import { assertNoDuplicateSitePayroll } from "../payroll-site-duplicates";

const batches = [
  { id: "adam", month: "2026-10", site: "Adam" },
  { id: "t59", month: "2026-10", site: "T-59" },
  { id: "adam2", month: "2026-10", site: " adam " },
];
const existing = [{ id: "paid-line", batch_id: "adam", employee_id: 7 }];
describe("server payroll duplicate preflight", () => {
  it("allows T-59 without replacing Adam's existing line", () => {
    expect(() => assertNoDuplicateSitePayroll([{ batch_id: "t59", employee_id: 7 }], batches, existing)).not.toThrow();
    expect(existing[0]?.id).toBe("paid-line");
    expect(existing[0]?.batch_id).toBe("adam");
  });
  it("blocks another batch at the same site", () => {
    expect(() => assertNoDuplicateSitePayroll([{ batch_id: "adam2", employee_id: 7 }], batches, existing)).toThrow("already included");
  });
  it("blocks an all-sites batch alongside a site batch", () => {
    expect(() => assertNoDuplicateSitePayroll([{ batch_id: "all", employee_id: 7 }], [...batches, { id: "all", month: "2026-10", site: "Multiple sites" }], existing)).toThrow("already included");
  });
  it("allows an update to its own line but not moving a line between sites", () => {
    expect(() => assertNoDuplicateSitePayroll(existing, batches, existing)).not.toThrow();
    expect(() => assertNoDuplicateSitePayroll([{ id: "paid-line", batch_id: "t59", employee_id: 7 }], batches, existing)).toThrow("cannot be moved");
  });
  it("blocks repeated employees in the submitted batch", () => {
    const row = { batch_id: "t59", employee_id: 7 };
    expect(() => assertNoDuplicateSitePayroll([row, row], batches, existing)).toThrow("more than once");
  });
  it("checks sibling batches within the same submission", () => {
    expect(() => assertNoDuplicateSitePayroll([
      { batch_id: "adam", employee_id: 7 },
      { batch_id: "adam2", employee_id: 7 },
    ], batches, [])).toThrow("already included");
    expect(() => assertNoDuplicateSitePayroll([
      { batch_id: "adam", employee_id: 7 },
      { batch_id: "t59", employee_id: 7 },
    ], batches, [])).not.toThrow();
  });
});