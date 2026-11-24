import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Download, Printer, Search, ShieldCheck } from "lucide-react";
import { dbAny } from "@/integrations/supabase/external-client";
import { fetchAllPages } from "@/lib/paged-query";
import { recordPayrollPayments, reversePayrollPayment } from "@/lib/payroll-payment.functions";
import {
  allocationPaymentStatus,
  remainingAllocationBalance,
  validatePaymentAmount,
} from "@/lib/payroll-payment";
import { btnGold, btnOutline, btnPrimary, card, input, select } from "./ui";
import type { Employee } from "@/lib/payroll";

interface Props {
  employees: Employee[];
  role: string;
  notify: (message: string, tone?: "ok" | "warn") => void;
}

interface Allocation {
  lineId: string;
  batchId: string;
  employeeId: number;
  month: string;
  siteId: string | null;
  siteName: string;
  foreman: string;
  foremanId: string | null;
  netPayable: number;
  paid: number;
  batchStatus: string;
}

interface PaymentTx {
  id: string;
  payroll_line_id: string;
  employee_id: number;
  payroll_month: string;
  site_name: string;
  foreman_name: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference_number: string | null;
  transaction_status: "COMPLETED" | "REVERSED";
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

const fmt = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function PayrollPaymentControlTab({ employees, role, notify }: Props) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"dashboard" | "site" | "employee" | "history">("dashboard");
  const [month, setMonth] = useState("");
  const [site, setSite] = useState("");
  const [foreman, setForeman] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "BANK" | "CHEQUE" | "TRANSFER" | "OTHER"
  >("BANK");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const dataQuery = useQuery({
    queryKey: ["payroll-payment-control"],
    queryFn: async () => {
      const [batches, lines, transactions, projects] = await Promise.all([
        fetchAllPages<any>(
          () =>
            dbAny
              .from("payroll_batches")
              .select("id,month,site,project_id,foreman,foreman_user_id,status")
              .order("month", { ascending: false }),
          "id",
        ),
        fetchAllPages<any>(
          () =>
            dbAny
              .from("payroll_lines")
              .select(
                "id,batch_id,employee_id,month,foreman,foreman_user_id,net_salary,net_pay,paid",
              )
              .order("id", { ascending: true }),
          "id",
        ),
        fetchAllPages<PaymentTx>(
          () =>
            dbAny
              .from("payroll_payment_transactions")
              .select("*")
              .order("created_at", { ascending: false }),
          "id",
        ),
        fetchAllPages<{ id: string; name: string }>(
          () => dbAny.from("projects").select("id,name").order("name", { ascending: true }),
          "id",
        ),
      ]);
      const batchMap = new Map(batches.map((batch: any) => [batch.id, batch]));
      const allocations: Allocation[] = lines.map((line: any) => {
        const batch = batchMap.get(line.batch_id) ?? {};
        const net = Number(line.net_pay ?? line.net_salary ?? 0);
        return {
          lineId: line.id,
          batchId: line.batch_id,
          employeeId: Number(line.employee_id),
          month: String(line.month ?? batch.month ?? ""),
          siteId: batch.project_id ?? null,
          siteName: String(batch.site ?? ""),
          foreman: String(line.foreman ?? batch.foreman ?? ""),
          foremanId: line.foreman_user_id ?? batch.foreman_user_id ?? null,
          netPayable: net,
          paid: Number(line.paid ?? 0),
          batchStatus: String(batch.status ?? ""),
        };
      });
      return { allocations, transactions, projects };
    },
    staleTime: 30_000,
  });

  const allocations = dataQuery.data?.allocations ?? [];
  const transactions = dataQuery.data?.transactions ?? [];
  const projects = dataQuery.data?.projects ?? [];
  const months = useMemo(
    () => [...new Set(allocations.map((a) => a.month).filter(Boolean))].sort().reverse(),
    [allocations],
  );
  const sites = useMemo(
    () =>
      projects
        .map((p) => p.name)
        .filter(Boolean)
        .sort(),
    [projects],
  );
  const foremen = useMemo(
    () => [...new Set(allocations.map((a) => a.foreman).filter(Boolean))].sort(),
    [allocations],
  );

  const filtered = useMemo(
    () =>
      allocations.filter(
        (a) =>
          (!month || a.month === month) &&
          (!site || a.siteName === site) &&
          (!foreman || a.foreman === foreman) &&
          (!selectedEmployee || a.employeeId === selectedEmployee),
      ),
    [allocations, month, site, foreman, selectedEmployee],
  );

  const payable = filtered.reduce((sum, a) => sum + a.netPayable, 0);
  const paid = filtered.reduce((sum, a) => sum + a.paid, 0);
  const outstanding = payable - paid;
  const statusCounts = useMemo(() => {
    const counts = { fully: 0, partial: 0, unpaid: 0 };
    filtered.forEach((a) => {
      const status = allocationPaymentStatus(a);
      if (status === "PAID") counts.fully++;
      else if (status === "PARTIALLY_PAID") counts.partial++;
      else if (status === "UNPAID") counts.unpaid++;
    });
    return counts;
  }, [filtered]);
  const outstandingSites = new Set(
    filtered.filter((a) => remainingAllocationBalance(a) > 0.0005).map((a) => a.siteName),
  ).size;

  const savePayments = useMutation({
    mutationFn: async () => {
      const payments = Object.entries(selected)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([lineId, amount]) => {
          const allocation = allocations.find((a) => a.lineId === lineId);
          if (!allocation) throw new Error("The payroll allocation could not be found.");
          const error = validatePaymentAmount(allocation, Number(amount));
          if (error) throw new Error(error);
          return {
            payroll_line_id: lineId,
            employee_id: allocation.employeeId,
            amount: Number(amount),
            payment_date: paymentDate,
            payment_method: paymentMethod,
            ...(reference.trim() ? { reference_number: reference.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          };
        });
      if (!payments.length) throw new Error("Select at least one outstanding allocation.");
      return recordPayrollPayments({
        data: {
          payments,
          idempotencyKey: `payment-${crypto.randomUUID()}`,
        },
      });
    },
    onSuccess: (result) => {
      notify(
        result?.duplicate
          ? "Duplicate submission ignored; no payment was added."
          : "Payments recorded securely.",
      );
      setSelected({});
      void queryClient.invalidateQueries({ queryKey: ["payroll-payment-control"] });
    },
    onError: (error) =>
      notify(error instanceof Error ? error.message : "Could not record payments.", "warn"),
  });

  const reversePayment = useMutation({
    mutationFn: (tx: PaymentTx) => {
      const reason = window.prompt("Enter a reason for reversing this payment:");
      if (!reason?.trim()) throw new Error("A reversal reason is required.");
      return reversePayrollPayment({ data: { transactionId: tx.id, reason: reason.trim() } });
    },
    onSuccess: () => {
      notify("Payment reversed with audit history preserved.");
      void queryClient.invalidateQueries({ queryKey: ["payroll-payment-control"] });
    },
    onError: (error) =>
      notify(error instanceof Error ? error.message : "Could not reverse payment.", "warn"),
  });

  const exportCsv = (rows: Array<Record<string, string | number>>) => {
    if (!rows.length) return;
    const columns = Object.keys(rows[0]!);
    const csv = [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => `"${String(row[column] ?? "").replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-payment-reconciliation-${month || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = filtered
      .map(
        (a) =>
          `<tr><td>${a.employeeId}</td><td>${a.month}</td><td>${a.siteName}</td><td>${fmt(a.netPayable)}</td><td>${fmt(a.paid)}</td><td>${fmt(remainingAllocationBalance(a))}</td></tr>`,
      )
      .join("");
    win.document.write(
      `<html><head><title>Payroll Payment Reconciliation</title></head><body><h1>Payroll Payment Reconciliation</h1><table border="1" cellpadding="6"><thead><tr><th>Employee</th><th>Month</th><th>Site</th><th>Net</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
    );
    win.document.close();
    win.print();
  };

  const outstandingAllocations = (mode === "employee" && !selectedEmployee ? [] : filtered).filter(
    (a) => remainingAllocationBalance(a) > 0.0005,
  );
  const employeeMatches = employeeQuery.trim()
    ? employees.filter(
        (e) =>
          e.name.toLowerCase().includes(employeeQuery.toLowerCase()) ||
          e.trade.toLowerCase().includes(employeeQuery.toLowerCase()) ||
          String(e.id).includes(employeeQuery) ||
          String(e.id_number).toLowerCase().includes(employeeQuery.toLower()),
      )
    : employees;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Payment control
          </p>
          <h1 className="font-display text-2xl font-extrabold text-navy">
            Payroll Payment Control
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["dashboard", "site", "employee", "history"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={item === mode ? btnGold : btnOutline}
            >
              {item === "dashboard"
                ? "Dashboard"
                : item === "site"
                  ? "Site payment"
                  : item === "employee"
                    ? "Employee payment"
                    : "History"}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-2 md:grid-cols-5">
        <select className={select} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select className={select} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className={select} value={foreman} onChange={(e) => setForeman(e.target.value)}>
          <option value="">All foremen</option>
          {foremen.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button type="button" className={btnOutline} onClick={printReport}>
          <Printer size={15} />
          Print/PDF
        </button>
        <button
          type="button"
          className={btnOutline}
          onClick={() =>
            exportCsv(
              filtered.map((a) => ({
                EmployeeID: a.employeeId,
                Month: a.month,
                Site: a.siteName,
                Foreman: a.foreman,
                Net: a.netPayable,
                Paid: a.paid,
                Balance: remainingAllocationBalance(a),
              })),
            )
          }
        >
          <Download size={15} />
          CSV
        </button>
      </div>

      {mode === "dashboard" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total payable", payable],
            ["Total paid", paid],
            ["Outstanding", outstanding],
            ["Outstanding sites", outstandingSites],
            ["Fully paid", statusCounts.fully],
            ["Partially paid", statusCounts.partial],
            ["Unpaid", statusCounts.unpaid],
            ["Allocations", filtered.length],
          ].map(([label, value]) => (
            <article key={String(label)} className={`${card} p-4`}>
              <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-extrabold text-navy">
                {(typeof value === "number" && String(label).includes("paid")) ||
                label === "Outstanding" ||
                label === "Total payable"
                  ? fmt(Number(value))
                  : String(value)}
              </p>
            </article>
          ))}
        </div>
      )}

      {(mode === "site" || mode === "employee") && (
        <div className={`${card} p-4 space-y-4`}>
          {mode === "employee" && (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-3 text-slate-400" />
                <input
                  className={`${input} pl-9`}
                  placeholder="Employee name, ID or trade"
                  value={employeeQuery}
                  onChange={(e) => setEmployeeQuery(e.target.value)}
                />
              </div>
              <select
                className={select}
                value={selectedEmployee ?? ""}
                onChange={(e) =>
                  setSelectedEmployee(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Select employee</option>
                {employeeMatches.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.id_number || e.id} — {e.trade}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Employee</th>
                  <th>Month</th>
                  <th>Site</th>
                  <th className="text-right">Net payable</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {outstandingAllocations.map((a) => {
                  const employee = employees.find((e) => e.id === a.employeeId);
                  const balance = remainingAllocationBalance(a);
                  return (
                    <tr key={a.lineId} className="border-b">
                      <td className="p-2 font-semibold">{employee?.name ?? a.employeeId}</td>
                      <td>{a.month}</td>
                      <td>{a.siteName}</td>
                      <td className="text-right">{fmt(a.netPayable)}</td>
                      <td className="text-right">{fmt(a.paid)}</td>
                      <td className="text-right font-bold">{fmt(balance)}</td>
                      <td className="py-2 text-right">
                        <input
                          aria-label={`Payment amount for ${employee?.name ?? a.employeeId}`}
                          className={`${input} ml-auto w-28 text-right`}
                          type="number"
                          min="0"
                          max={balance}
                          step="0.001"
                          value={selected[a.lineId] ?? ""}
                          onChange={(e) =>
                            setSelected((current) => ({
                              ...current,
                              [a.lineId]: Number(e.target.value),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mode === "site" && outstandingAllocations.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() =>
                  setSelected(
                    Object.fromEntries(
                      outstandingAllocations.map((a) => [a.lineId, remainingAllocationBalance(a)]),
                    ),
                  )
                }
              >
                Select All / Full balances
              </button>
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-4">
            <input
              className={input}
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
            <select
              className={select}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
            >
              {["CASH", "BANK", "CHEQUE", "TRANSFER", "OTHER"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className={input}
              placeholder="Reference number"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <input
              className={input}
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={savePayments.isPending || Object.keys(selected).length === 0}
              className={btnPrimary}
              onClick={() => savePayments.mutate()}
            >
              <Banknote size={15} />
              {savePayments.isPending ? "Saving…" : "Review and save payments"}
            </button>
          </div>
        </div>
      )}

      {mode === "history" && (
        <div className={`${card} p-4 overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Date</th>
                <th>Employee</th>
                <th>Month</th>
                <th>Site</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions
                .filter(
                  (tx) =>
                    (!month || tx.payroll_month === month) && (!site || tx.site_name === site),
                )
                .map((tx) => {
                  const employee = employees.find((e) => e.id === tx.employee_id);
                  return (
                    <tr key={tx.id} className="border-b">
                      <td className="p-2">{tx.payment_date}</td>
                      <td>{employee?.name ?? tx.employee_id}</td>
                      <td>{tx.payroll_month}</td>
                      <td>{tx.site_name}</td>
                      <td>{tx.payment_method}</td>
                      <td>{tx.reference_number ?? "—"}</td>
                      <td className="text-right font-bold">{fmt(Number(tx.amount))}</td>
                      <td>{tx.transaction_status}</td>
                      <td>
                        {["admin", "hr"].includes(role) && tx.transaction_status === "COMPLETED" ? (
                          <button
                            type="button"
                            className={btnOutline}
                            onClick={() => reversePayment.mutate(tx)}
                          >
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {dataQuery.isLoading && <p className="text-sm text-slate-500">Loading payment records…</p>}
      {dataQuery.error && (
        <p className="text-sm text-danger">
          {dataQuery.error instanceof Error
            ? dataQuery.error.message
            : "Could not load payment records."}
        </p>
      )}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck size={14} />
        Payment allocations are protected by employee, payroll line, month and site.
      </div>
    </section>
  );
}
