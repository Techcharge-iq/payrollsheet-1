import { describe, it, expect, vi } from "vitest";
import { consolidateSlips, generateSalarySlipPDF, type SlipInput } from "../slip-pdf";
import type { Employee, HistoryRow } from "../payroll";

// Mock fetch for /Salary Header.png in node test environment
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  blob: async () => new Blob(["fake-image-bytes"], { type: "image/png" }),
}) as unknown as typeof fetch;

// Mock FileReader for jsPDF loadHeaderImage
class MockFileReader {
  result: string | null = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    setTimeout(() => this.onload?.(), 0);
  }
}
// @ts-expect-error test mock
globalThis.FileReader = MockFileReader;

const dummyEmployee: Employee = {
  id: 101,
  id_number: "EMP-101",
  name: "John Doe",
  trade: "Mason",
  hourly_rate: 1.2,
  default_food_deduction: 15,
  status: "Active",
};

const makeRow = (overrides: Partial<HistoryRow>): HistoryRow => ({
  id: "line-1",
  batchId: "batch-1",
  employee_id: 101,
  month: "2026-10",
  site: "Adam Site",
  hours: "100",
  rate: "1.2",
  food_deduction: "15",
  prev_advance: "0",
  new_advance: "0",
  other_deduction: "0",
  net_salary: "105",
  paid: "105",
  foreman: "Foreman Ali",
  batchForeman: "Foreman Ali",
  ...overrides,
});

describe("Consolidated Salary Slip Generation", () => {
  it("aggregates multi-site records for the same employee and pay period into one slip", () => {
    const slipSiteA: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        id: "line-1",
        site: "Adam Site",
        hours: "100",
        rate: "1.2",
        food_deduction: "15",
        net_salary: "105",
        paid: "105",
      }),
      carriedForward: 50,
      outstandingAdvance: 20,
    };

    const slipSiteB: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        id: "line-2",
        site: "T-59 Site",
        hours: "80",
        rate: "1.2",
        food_deduction: "10",
        net_salary: "86",
        paid: "86",
      }),
      carriedForward: 50,
      outstandingAdvance: 20,
    };

    const consolidated = consolidateSlips([slipSiteA, slipSiteB]);

    // Must be exactly 1 consolidated slip
    expect(consolidated).toHaveLength(1);
    const slip = consolidated[0]!;

    expect(slip.employee.name).toBe("John Doe");
    expect(slip.month).toBe("2026-10");

    // Total hours: 100 + 80 = 180
    expect(slip.row.hours).toBe(180);

    // Total food deduction: 15 + 10 = 25
    expect(slip.row.food_deduction).toBe(25);

    // Total net salary: 105 + 86 = 191
    expect(slip.row.net_salary).toBe(191);

    // Site breakdown should contain both sites
    expect(slip.siteBreakdown).toBeDefined();
    expect(slip.siteBreakdown).toHaveLength(2);

    const adam = slip.siteBreakdown!.find((s) => s.site === "Adam Site");
    const t59 = slip.siteBreakdown!.find((s) => s.site === "T-59 Site");

    expect(adam).toEqual({ site: "Adam Site", hours: 100, foodDeduction: 15 });
    expect(t59).toEqual({ site: "T-59 Site", hours: 80, foodDeduction: 10 });
  });

  it("handles single-site employees gracefully", () => {
    const singleSlip: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        site: "Only One Site",
        hours: "150",
        food_deduction: "20",
        net_salary: "160",
      }),
      carriedForward: 0,
      outstandingAdvance: 0,
    };

    const consolidated = consolidateSlips([singleSlip]);
    expect(consolidated).toHaveLength(1);
    const slip = consolidated[0]!;
    expect(slip.siteBreakdown).toHaveLength(1);
    expect(slip.siteBreakdown![0]).toEqual({
      site: "Only One Site",
      hours: 150,
      foodDeduction: 20,
    });
  });

  it("handles zero food deduction gracefully", () => {
    const noFoodSlip: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        site: "Camp Site",
        hours: "120",
        food_deduction: "0",
        net_salary: "144",
      }),
      carriedForward: 0,
      outstandingAdvance: 0,
    };

    const consolidated = consolidateSlips([noFoodSlip]);
    expect(consolidated).toHaveLength(1);
    const slip = consolidated[0]!;
    expect(slip.row.food_deduction).toBe(0);
    expect(slip.siteBreakdown![0]!.foodDeduction).toBe(0);
  });

  it("generates a PDF blob for consolidated multi-site slip without error", async () => {
    const slip: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        site: "Adam Site",
        hours: "100",
        rate: "1.2",
        food_deduction: "15",
        net_salary: "105",
      }),
      rows: [
        makeRow({ site: "Adam Site", hours: "100", food_deduction: "15" }),
        makeRow({ site: "T-59 Site", hours: "80", food_deduction: "10" }),
      ],
      carriedForward: 50,
      outstandingAdvance: 15.5, // > 1, triggers red outline
    };

    const blob = await generateSalarySlipPDF(
      slip,
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("generates a PDF blob with outstanding <= 1 without error", async () => {
    const slip: SlipInput = {
      employee: dummyEmployee,
      month: "2026-10",
      row: makeRow({
        site: "Adam Site",
        hours: "100",
        food_deduction: "0",
      }),
      carriedForward: 0,
      outstandingAdvance: 0.5, // <= 1, no red outline
    };

    const blob = await generateSalarySlipPDF(
      slip,
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
