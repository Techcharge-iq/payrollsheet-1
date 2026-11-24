/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PayrollPaymentInput {
  payroll_line_id: string;
  employee_id: number;
  amount: number;
  payment_date: string;
  payment_method: "CASH" | "BANK" | "CHEQUE" | "TRANSFER" | "OTHER";
  reference_number?: string;
  notes?: string;
}

const paymentSchema = z.object({
  payroll_line_id: z.string().uuid(),
  employee_id: z.number().int().positive(),
  amount: z.number().positive().max(1000000),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(["CASH", "BANK", "CHEQUE", "TRANSFER", "OTHER"]),
  reference_number: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const recordPayrollPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        payments: z.array(paymentSchema).min(1).max(1000),
        idempotencyKey: z.string().min(8).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const authDb = context.supabase as SupabaseClient<any>;
    const { data: profile, error } = await authDb
      .from("users")
      .select("role,is_active")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error("Could not verify payroll payment permission.");
    if (!profile?.is_active || !["admin", "hr", "manager"].includes(profile.role)) {
      throw new Error("You do not have permission to record payroll payments.");
    }

    const { data: result, error: rpcError } = await authDb.rpc("record_payroll_payments", {
      p_payments: data.payments,
      p_idempotency_key: data.idempotencyKey,
    });
    if (rpcError) {
      throw new Error(rpcError.message || "The payment could not be recorded.");
    }
    return result as { duplicate: boolean; transactions: unknown };
  });

export const reversePayrollPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        transactionId: z.string().uuid(),
        reason: z.string().trim().min(3).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const authDb = context.supabase as SupabaseClient<any>;
    const { data: profile, error } = await authDb
      .from("users")
      .select("role,is_active")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error("Could not verify payroll payment permission.");
    if (!profile?.is_active || !["admin", "hr"].includes(profile.role)) {
      throw new Error("Only an administrator or payroll accountant can reverse payments.");
    }
    const { data: result, error: rpcError } = await authDb.rpc("reverse_payroll_payment", {
      p_transaction_id: data.transactionId,
      p_reason: data.reason,
    });
    if (rpcError) throw new Error(rpcError.message || "Could not reverse payment.");
    return { reversalId: result };
  });
