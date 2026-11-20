import { describe, expect, it } from "vitest";
import { assertUnpaidPayrollDeletion, canDeleteUnpaidPayroll, hasProtectedPayrollPayment } from "../payroll-deletion";

describe("unpaid payroll deletion", () => {
  it("allows the marked unpaid Legacy T-57 batch", () => {
    expect(canDeleteUnpaidPayroll({ status: "LEGACY", lines: [{ paid: 0 }] })).toBe(true);
  });
  it("allows the marked unpaid Approved multiple-sites batch", () => {
    expect(canDeleteUnpaidPayroll({ status: "APPROVED", lines: [{ paid: 0 }] })).toBe(true);
  });
  it("protects a Paid batch even if amounts are zero", () => {
    expect(canDeleteUnpaidPayroll({ status: "PAID", lines: [{ paid: 0 }] })).toBe(false);
  });
  it("protects partially paid batches and does not offset negative amounts", () => {
    expect(canDeleteUnpaidPayroll({ status: "LEGACY", lines: [{ paid: 1 }, { paid: -1 }] })).toBe(false);
  });
  it("protects payment-marked and locked batches", () => {
    expect(canDeleteUnpaidPayroll({ status: "APPROVED", paid_at: "2026-10-31", lines: [{ paid: 0 }] })).toBe(false);
    expect(canDeleteUnpaidPayroll({ status: "LOCKED", lines: [{ paid: 0 }] })).toBe(false);
  });
  it("fails closed on invalid amounts and rejects deletion before writes", () => {
    expect(() => assertUnpaidPayrollDeletion({ status: "DRAFT", lines: [{ paid: "invalid" }] })).toThrow("Paid records are protected");
  });
  it("protects missing payment values consistently with database deletion", () => {
    expect(canDeleteUnpaidPayroll({ status: "LEGACY", lines: [{ paid: null }] })).toBe(false);
    expect(canDeleteUnpaidPayroll({ status: "APPROVED", lines: [{ paid: undefined }] })).toBe(false);
  });
  it("protects payments before status changes to Paid", () => {
    expect(hasProtectedPayrollPayment({ status: "DRAFT", lines: [{ paid: 1 }] })).toBe(true);
  });
});