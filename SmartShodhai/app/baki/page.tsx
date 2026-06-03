"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { MessageSquareText, Plus, Send, Wallet2, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatCurrencyBDT, formatNumberBD } from "@/lib/format";
import {
  sanitizeCustomerName,
  sanitizeNotes,
} from "@/lib/validation";
import type { BakiRecord } from "@/types";

type ToastState = { type: "success" | "error"; message: string } | null;

type AddEntryForm = {
  customer_name: string;
  customer_phone: string;
  amount_owed: string;
  notes: string;
};

const emptyAddForm: AddEntryForm = {
  customer_name: "",
  customer_phone: "",
  amount_owed: "",
  notes: "",
};

const dateDisplay = new Intl.DateTimeFormat("en-BD", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function daysSince(dateText: string): number {
  const ms = Date.now() - new Date(dateText).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function buildReminderMessage(customerName: string, amount: number): string {
  return `আসালামু আলাইকুম ${customerName} ভাই, আপনার কাছে ${Math.round(
    amount
  )} টাকা বাকি আছে। দয়া করে পরিশোধ করুন। ধন্যবাদ।`;
}

export default function BakiPage() {
  const [records, setRecords] = useState<BakiRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddSaving, setIsAddSaving] = useState(false);
  const [addForm, setAddForm] = useState<AddEntryForm>(emptyAddForm);

  const [receiveTarget, setReceiveTarget] = useState<BakiRecord | null>(null);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [isReceiveSaving, setIsReceiveSaving] = useState(false);
  const [reminderTarget, setReminderTarget] = useState<BakiRecord | null>(null);
  const [reminderMessage, setReminderMessage] = useState("");
  const [isBulkReminderOpen, setIsBulkReminderOpen] = useState(false);

  useEffect(() => {
    void loadBaki();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function loadBaki() {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRecords([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("baki")
        .select("id, customer_name, customer_phone, amount_owed, last_updated, notes")
        .eq("owner_id", user.id)
        .order("amount_owed", { ascending: false });

      if (error) {
        setToast({ type: "error", message: "Failed to load baki records." });
        setRecords([]);
        return;
      }

      setRecords((data ?? []) as BakiRecord[]);
    } catch {
      setToast({ type: "error", message: "Failed to load baki records." });
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addForm.customer_name.trim() || !addForm.amount_owed.trim()) {
      setToast({ type: "error", message: "Customer name and amount are required." });
      return;
    }

    setIsAddSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to add baki." });
      setIsAddSaving(false);
      return;
    }

    const payload = {
      owner_id: user.id,
      customer_name: sanitizeCustomerName(addForm.customer_name),
      customer_phone: addForm.customer_phone.trim() || null,
      amount_owed: Number(addForm.amount_owed),
      notes: addForm.notes.trim() ? sanitizeNotes(addForm.notes) : null,
      last_updated: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("baki")
      .insert(payload)
      .select("id, customer_name, customer_phone, amount_owed, last_updated, notes")
      .single();

    if (error) {
      setToast({ type: "error", message: "Failed to add baki entry." });
      setIsAddSaving(false);
      return;
    }

    setRecords((prev) =>
      [...prev, data as BakiRecord].sort((a, b) => b.amount_owed - a.amount_owed)
    );
    setToast({ type: "success", message: "Baki entry added successfully." });
    setIsAddSaving(false);
    setIsAddOpen(false);
    setAddForm(emptyAddForm);
  }

  async function handleReceiveMoney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiveTarget) return;
    if (!receiveAmount.trim()) {
      setToast({ type: "error", message: "Amount received is required." });
      return;
    }

    const paid = Number(receiveAmount);
    if (Number.isNaN(paid) || paid <= 0) {
      setToast({ type: "error", message: "Enter a valid amount received." });
      return;
    }

    setIsReceiveSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to record payment." });
      setIsReceiveSaving(false);
      return;
    }

    const newAmount = receiveTarget.amount_owed - paid;
    const updatedAmount = newAmount > 0 ? newAmount : 0;
    const nowIso = new Date().toISOString();

    const updateResult = await supabase
      .from("baki")
      .update({
        amount_owed: updatedAmount,
        last_updated: nowIso,
      })
      .eq("owner_id", user.id)
      .eq("id", receiveTarget.id)
      .select("id, customer_name, customer_phone, amount_owed, last_updated, notes")
      .single();

    if (updateResult.error) {
      setToast({ type: "error", message: "Failed to update baki balance." });
      setIsReceiveSaving(false);
      return;
    }

    const paymentInsert = await supabase.from("baki_payments").insert({
      owner_id: user.id,
      baki_id: receiveTarget.id,
      customer_name: receiveTarget.customer_name,
      amount_received: paid,
      previous_balance: receiveTarget.amount_owed,
      new_balance: updatedAmount,
      payment_date: nowIso,
    });

    if (paymentInsert.error) {
      setToast({
        type: "error",
        message:
          "Balance updated, but payment log failed. Add baki_payments table via migration.",
      });
    } else {
      setToast({
        type: "success",
        message:
          updatedAmount <= 0
            ? "Payment recorded. Debt cleared."
            : "Payment recorded and baki updated.",
      });
    }

    setRecords((prev) =>
      prev
        .map((row) => (row.id === receiveTarget.id ? (updateResult.data as BakiRecord) : row))
        .sort((a, b) => b.amount_owed - a.amount_owed)
    );
    setIsReceiveSaving(false);
    setReceiveAmount("");
    setReceiveTarget(null);
  }

  const filtered = useMemo(() => {
    return records
      .filter((row) =>
        row.customer_name.toLowerCase().includes(search.trim().toLowerCase())
      )
      .sort((a, b) => b.amount_owed - a.amount_owed);
  }, [records, search]);

  const summary = useMemo(() => {
    const totalBaki = records.reduce((sum, row) => sum + row.amount_owed, 0);
    const debtors = records.filter((row) => row.amount_owed > 0).length;
    const highestDebt = records.reduce((max, row) => Math.max(max, row.amount_owed), 0);
    return { totalBaki, debtors, highestDebt };
  }, [records]);

  const agingData = useMemo(() => {
    const buckets = { "0-30 days": 0, "31-60 days": 0, "60+ days": 0 };
    for (const row of records) {
      if (row.amount_owed <= 0) continue;
      const age = daysSince(row.last_updated);
      if (age <= 30) buckets["0-30 days"] += 1;
      else if (age <= 60) buckets["31-60 days"] += 1;
      else buckets["60+ days"] += 1;
    }
    return [
      { bucket: "0-30 days", count: buckets["0-30 days"] },
      { bucket: "31-60 days", count: buckets["31-60 days"] },
      { bucket: "60+ days", count: buckets["60+ days"] },
    ];
  }, [records]);

  const reminderCandidates = useMemo(
    () => records.filter((row) => row.amount_owed > 0 && Boolean(row.customer_phone?.trim())),
    [records]
  );

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm text-slate-500">Total Baki</p>
          <p className="mt-2 text-2xl font-bold text-red-600">{formatCurrencyBDT(summary.totalBaki)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm text-slate-500">Number of Debtors</p>
          <p className="mt-2 text-2xl font-bold text-indigo-700">{formatNumberBD(summary.debtors)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm text-slate-500">Highest Single Debt</p>
          <p className="mt-2 text-2xl font-bold text-orange-600">
            {formatCurrencyBDT(summary.highestDebt)}
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-indigo-700">Baki Ledger</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsBulkReminderOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
            >
              <MessageSquareText className="h-4 w-4" />
              Send All Reminders
            </button>
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800"
            >
              <Plus className="h-4 w-4" />
              Add Baki Entry
            </button>
          </div>
        </div>

        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search customer name..."
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[860px] divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Customer Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phone Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Amount Owed
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Last Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr className="animate-pulse">
                  <td colSpan={5} className="px-4 py-8">
                    <div className="space-y-2">
                      <div className="loading-skeleton h-4 w-full" />
                      <div className="loading-skeleton h-4 w-10/12" />
                      <div className="loading-skeleton h-4 w-8/12" />
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <MessageSquareText className="h-7 w-7 text-slate-400" />
                      <p>সব হিসাব পরিষ্কার! No outstanding baki</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-700">
                      <div className="flex items-center gap-2">
                        <span>{row.customer_name}</span>
                        {row.amount_owed <= 0 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            Cleared
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {row.customer_phone || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-red-600">
                      {formatCurrencyBDT(row.amount_owed)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {dateDisplay.format(new Date(row.last_updated))}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setReceiveTarget(row);
                            setReceiveAmount("");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <Wallet2 className="h-3.5 w-3.5" />
                          Receive Money
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReminderTarget(row);
                            setReminderMessage(
                              buildReminderMessage(row.customer_name, row.amount_owed)
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                          Send Reminder
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h3 className="mb-4 text-sm font-semibold text-slate-700">Baki Aging</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agingData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => `${Number(value ?? 0)} customers`} />
              <Bar dataKey="count" fill="#4f46e5" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {isAddOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setIsAddOpen(false)}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Add Baki Entry</h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close add entry modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddEntry} className="space-y-4 p-5">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Customer Name *</span>
                <input
                  type="text"
                  required
                  value={addForm.customer_name}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, customer_name: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Phone Number</span>
                <input
                  type="text"
                  value={addForm.customer_phone}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, customer_phone: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Amount Owed (৳) *</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={addForm.amount_owed}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, amount_owed: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Notes</span>
                <textarea
                  value={addForm.notes}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddSaving}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAddSaving ? "Saving..." : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setReceiveTarget(null)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Receive Money</h3>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close receive money modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleReceiveMoney} className="space-y-4 p-5">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm text-slate-500">Customer</p>
                <p className="font-semibold text-slate-800">{receiveTarget.customer_name}</p>
                <p className="mt-2 text-sm text-slate-500">Current Balance</p>
                <p className="text-xl font-bold text-red-600">
                  {formatCurrencyBDT(receiveTarget.amount_owed)}
                </p>
              </div>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Amount Received (৳)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={receiveAmount}
                  onChange={(e) => setReceiveAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceiveTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReceiveSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isReceiveSaving ? "Saving..." : "Save Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed right-4 top-20 z-[60]">
          <div
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
              toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {reminderTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setReminderTarget(null)}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Send SMS Reminder</h3>
              <button
                type="button"
                onClick={() => setReminderTarget(null)}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close reminder modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Customer</p>
                <p className="font-semibold text-slate-800">{reminderTarget.customer_name}</p>
                <p className="mt-2 text-slate-500">Phone Number</p>
                <p className="font-medium text-slate-700">
                  {reminderTarget.customer_phone || "No phone number"}
                </p>
                <p className="mt-2 text-slate-500">Current Amount Owed</p>
                <p className="font-bold text-red-600">{formatCurrencyBDT(reminderTarget.amount_owed)}</p>
              </div>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Message (Editable)</span>
                <textarea
                  rows={4}
                  value={reminderMessage}
                  onChange={(e) => setReminderMessage(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                />
              </label>

              <p className="text-xs text-slate-500">SMS gateway integration coming soon</p>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReminderTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReminderTarget(null);
                    setToast({
                      type: "success",
                      message: `Reminder queued for ${reminderTarget.customer_name}.`,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isBulkReminderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setIsBulkReminderOpen(false)}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Send All Reminders</h3>
              <button
                type="button"
                onClick={() => setIsBulkReminderOpen(false)}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close bulk reminder modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-700">
                This will send reminders to{" "}
                <span className="font-semibold">{reminderCandidates.length}</span> customers with
                active baki and phone numbers.
              </p>
              <p className="text-xs text-slate-500">SMS gateway integration coming soon</p>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkReminderOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsBulkReminderOpen(false);
                    setToast({
                      type: "success",
                      message: `Bulk reminder queued for ${reminderCandidates.length} customers.`,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
