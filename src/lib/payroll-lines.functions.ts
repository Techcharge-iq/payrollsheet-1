/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { payrollSaveErrorMessage } from "./payroll-save-error";
import { fetchAllPages } from "./paged-query";
import { assertNoDuplicateSitePayroll, type PayrollScopeBatch, type PayrollScopeLine } from "./payroll-site-duplicates";
import { assertPayrollDeductionLimits } from "./payroll-deduction-guard";
import type { FoodDeployment } from "./food-calendar";
import { nextPayrollMonth, type AdvanceTx, type PayrollBatch, type PayrollLine } from "./payroll";

const PAYROLL_WRITERS = new Set(["admin", "hr", "manager", "foreman"]);
// Only these roles may record a new advance on a payroll line.
const ADVANCE_ISSUERS = new Set(["admin", "hr"]);

const lineSchema = z
  .object({
    id: z.string().uuid().optional(),
    batch_id: z.string().uuid(),
    employee_id: z.number().int().positive(),
    new_advance: z.number().min(0).max(1_000_000),
    food_deduction: z.number().min(0),
    prev_advance: z.number().min(0),
    gross_pay: z.number().min(0),
    other_deduction: z.number().min(0),
  })
  .passthrough();

export const savePayrollLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ rows: z.array(lineSchema).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: me, error: roleError } = await (context.supabase as SupabaseClient<any>)
      .from("users")
      .select("role,is_active")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (roleError) throw new Error("Could not verify your payroll access.");
    if (!me?.is_active || !PAYROLL_WRITERS.has(me.role)) {
      throw new Error("You do not have permission to save payroll.");
    }
    const canIssueAdvance = ADVANCE_ISSUERS.has(me.role);

    const admin = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin as unknown as SupabaseClient<any>;

    if (!data.rows.length) return { rows: [] };
    const batchIds = [...new Set(data.rows.map((row) => row.batch_id))];
    const targets = await fetchAllPages<PayrollScopeBatch>(() => admin.from("payroll_batches")
      .select("id,month,site").in("id", batchIds));
    const months = [...new Set(targets.map((batch) => batch.month))];
    if (!months.length) throw new Error("The payroll batch was not found. Refresh and retry.");
    const [scopeBatches, scopeLines] = await Promise.all([
      fetchAllPages<PayrollScopeBatch>(() => admin.from("payroll_batches").select("id,month,site").in("month", months)),
      fetchAllPages<PayrollScopeLine>(() => admin.from("payroll_lines").select("id,batch_id,employee_id").in("month", months)),
    ]);
    assertNoDuplicateSitePayroll(data.rows.map((row) => ({
      batch_id: row.batch_id,
      employee_id: row.employee_id,
      ...(row.id ? { id: row.id } : {}),
    })), scopeBatches, scopeLines);

    // Non-issuers cannot change new_advance: keep the stored value (or 0 for new lines).
    const stored = new Map<string, number>();
    const ids = data.rows.flatMap((r) => (r.id ? [r.id] : []));
    if (!canIssueAdvance && ids.length) {
      const { data: existing, error } = await admin
        .from("payroll_lines")
        .select("id,new_advance")
        .in("id", ids);
      if (error) throw new Error("Could not load existing payroll lines.");
      (existing ?? []).forEach((row: any) => stored.set(row.id, Number(row.new_advance ?? 0)));
    }
    const rows = data.rows.map((row) => ({
      ...row,
      month: targets.find((batch) => batch.id === row.batch_id)?.month,
      new_advance: canIssueAdvance ? row.new_advance : row.id ? (stored.get(row.id) ?? 0) : 0,
    }));

    const [historyBatches, historyLines, advances, attendance, employees, settings, deployments] = await Promise.all([
      fetchAllPages<any>(() => admin.from("payroll_batches").select("id,month,site,status,paid_at,foreman")),
      fetchAllPages<any>(() => admin.from("payroll_lines").select("*")),
      fetchAllPages<AdvanceTx>(() => admin.from("advance_transactions").select("*")),
      fetchAllPages<any>(() => admin.from("timesheets").select("id,employee_id,work_date,site,status").gte("work_date", `${[...months].sort()[0]}-01`).lt("work_date", `${nextPayrollMonth([...months].sort().at(-1) ?? "")}-01`)),
      fetchAllPages<any>(() => admin.from("employees").select("id,default_food_deduction")),
      admin.from("payroll_settings").select("default_food_deduction").eq("singleton", true).maybeSingle(),
      fetchAllPages<FoodDeployment>(() => admin.from("employee_site_assignments").select("id,employee_id,site,effective_from,effective_to")),
    ]);
    if (settings.error) throw new Error("Could not verify monthly food deduction settings.");
    const history: PayrollBatch[] = historyBatches.map((batch: any) => ({ ...batch, lines: historyLines.filter((line: any) => line.batch_id === batch.id) as PayrollLine[] }));
    const foodDefaults = new Map<number, number>(employees.map((employee: any) => [Number(employee.id), Number(employee.default_food_deduction ?? settings.data?.default_food_deduction ?? 0)]));
    assertPayrollDeductionLimits(rows.map((row) => ({
      batch_id: row.batch_id,
      employee_id: row.employee_id,
      food_deduction: row.food_deduction,
      prev_advance: row.prev_advance,
      new_advance: row.new_advance,
      gross_pay: row.gross_pay,
      other_deduction: row.other_deduction,
      ...(row.id ? { id: row.id } : {}),
    })), history, advances, attendance, foodDefaults, deployments);

    const { data: saved, error } = await admin
      .from("payroll_lines")
      .upsert(rows as never, { onConflict: "id" })
      .select("*");
    if (error) throw new Error(payrollSaveErrorMessage(error));
    return { rows: saved ?? [] };
  });
