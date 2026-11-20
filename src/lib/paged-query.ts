interface PageError {
  message: string;
}

interface PagedQuery<T> {
  order(column: string, options: { ascending: boolean }): {
    range(from: number, to: number): PromiseLike<{
      data: T[] | null;
      error: PageError | null;
    }>;
  };
}

/** Read every API page; never return partial results after a failed page. */
export async function fetchAllPages<T = Record<string, unknown>>(
  query: () => PagedQuery<T>,
  orderKey = "id",
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await query()
      .order(orderKey, { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}