import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "../paged-query";

function fixture(count: number, failAt?: number) {
  const rows = Array.from({ length: count }, (_, id) => ({ id }));
  const range = vi.fn(async (start: number, end: number) => ({
    data: rows.slice(start, end + 1),
    error: failAt === start ? { message: "Connection lost" } : null,
  }));
  const order = vi.fn(() => ({ range }));
  return { query: () => ({ order }), rows, order, range };
}

describe("complete paged attendance and roster reads", () => {
  it("returns all 2,031 records across three pages in stable ID order", async () => {
    const data = fixture(2031);
    expect(await fetchAllPages(data.query)).toEqual(data.rows);
    expect(data.range.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(data.order).toHaveBeenCalledWith("id", { ascending: true });
  });
  it("checks an empty terminal page after an exact 1,000-row boundary", async () => {
    const data = fixture(1000);
    expect(await fetchAllPages(data.query)).toHaveLength(1000);
    expect(data.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
  it("rejects a later page failure instead of returning the first 1,000 rows", async () => {
    const data = fixture(1500, 1000);
    await expect(fetchAllPages(data.query)).rejects.toEqual({ message: "Connection lost" });
  });
  it("handles an empty roster and supports the user ID ordering key", async () => {
    const data = fixture(0);
    expect(await fetchAllPages(data.query, "user_id")).toEqual([]);
    expect(data.order).toHaveBeenCalledWith("user_id", { ascending: true });
    expect(data.range).toHaveBeenCalledTimes(1);
  });
});