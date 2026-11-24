/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertUnpaidPayrollDeletion, hasProtectedPayrollPayment } from "./payroll-deletion";
import { fetchAllPages } from "./paged-query";

const deleteInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("employee"), id: z.number().int().positive() }),
  z.object({ type: z.literal("site"), id: z.string().uuid() }),
  z.object({ type: z.literal("payroll"), id: z.string().uuid() }),
]);

export const deletePayrollRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const authDb = context.supabase as SupabaseClient<any>;
    const { data: profile, error: profileError } = await authDb
      .from("users")
      .select("role,is_active,email")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (profileError) throw new Error(`Could not verify delete access: ${profileError.message}`);
    if (!profile?.is_active) throw new Error("This account is inactive.");
    if (profile.role !== "admin") {
      throw new Error("Only an active administrator can delete records.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient<any>;
    if (data.type === "employee") {
      const payrollLines = await fetchAllPages<{ id: string; batch_id: string; paid: number }>(() => admin
        .from("payroll_lines").select("id,batch_id,paid").eq("employee_id", data.id));
      const batchIds = [...new Set(payrollLines.map((line) => line.batch_id))];
      for (let start = 0; start < batchIds.length; start += 100) {
        const batches = await fetchAllPages<{ id: string; status: string; paid_at: string | null; paid_by: string | null }>(() => admin
          .from("payroll_batches").select("id,status,paid_at,paid_by").in("id", batchIds.slice(start, start + 100)));
        if (batches.some((batch) => hasProtectedPayrollPayment({ ...batch, lines: payrollLines.filter((line) => line.batch_id === batch.id) }))) {
          throw new Error("This employee has paid payroll history and cannot be deleted. Paid records are protected.");
        }
      }
      const { error } = await admin.rpc("delete_employee_with_history", {
        target_employee_id: data.id,
      });
      if (error) throw new Error(`Could not delete employee and related history: ${error.message}`);
      return { type: data.type, id: data.id };
    }
    if (data.type === "site") {
      const { error } = await admin.rpc("delete_project_with_assignments", {
        target_project_id: data.id,
      });
      if (error) throw new Error(`Could not delete site and its assignments: ${error.message}`);
      return { type: data.type, id: data.id };
    }

    const { data: batch, error: batchError } = await admin
      .from("payroll_batches")
      .select("id,status,paid_at,paid_by")
      .eq("id", data.id)
      .maybeSingle();
    if (batchError) throw new Error(`Could not check payroll payments: ${batchError.message}`);
    if (!batch) throw new Error("The payroll batch was not found or was already deleted.");
    const lines = await fetchAllPages<{ id: string; paid: number }>(() => admin
      .from("payroll_lines").select("id,paid").eq("batch_id", data.id));
    const transactions = await fetchAllPages<{ id: string }>(() => admin
      .from("payroll_payment_transactions").select("id").eq("batch_id", data.id));
    if (transactions.length) {
      throw new Error("Payroll with recorded payment transactions cannot be deleted. Financial history is protected.");
    }
    assertUnpaidPayrollDeletion({ status: batch.status, paid_at: batch.paid_at, paid_by: batch.paid_by, lines });
    // One transaction rechecks and locks payment state, deletes children before parent,
    // and rolls everything back if any lifecycle guard rejects deletion.
    const { data: deleted, error } = await admin.rpc("delete_unpaid_payroll_batch", {
      target_batch_id: data.id,
    });
    if (error?.code === "PGRST202" || error?.code === "42883") {
      throw new Error("Safe payroll deletion is not installed in the external payroll database. Apply the unpaid-batch deletion repair, then retry. No records were deleted.");
    }
    if (error) throw new Error(`Could not delete payroll batch: ${error.message}`);
    if (!deleted) throw new Error("The payroll batch was not found or was already deleted.");
    return { type: data.type, id: data.id, lineIds: lines.map((line) => line.id) };
  });
