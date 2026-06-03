"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { productsSelectQuery } from "@/lib/products-query";
import { formatCurrencyBDT } from "@/lib/format";
import { fetchUserRole } from "@/lib/user-role";
import {
  sanitizeCustomerName,
  sanitizeNotes,
} from "@/lib/validation";
import type { Product, SaleLog } from "@/types";

type ToastState = { type: "success" | "error"; message: string } | null;

type SaleLogRow = SaleLog & {
  notes?: string | null;
};

type SaleForm = {
  product_name: string;
  qty_sold: string;
  unit_price: string;
  customer_name: string;
  is_baki: boolean;
  sale_date: string;
  notes: string;
};

const dayFormatter = new Intl.DateTimeFormat("en-BD", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const emptyForm: SaleForm = {
  product_name: "",
  qty_sold: "",
  unit_price: "",
  customer_name: "",
  is_baki: false,
  sale_date: todayIsoDate(),
  notes: "",
};

export default function SalesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<SaleLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productFilter, setProductFilter] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadData() {
    setIsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setProducts([]);
        setSales([]);
        setIsLoading(false);
        return;
      }

      const role = await fetchUserRole(supabase, user.id);

      const [productsRes, salesRes] = await Promise.all([
        productsSelectQuery(supabase, user.id, role, "compact").order("name", {
          ascending: true,
        }),
        supabase
          .from("sales_log")
          .select("id, product_name, qty_sold, customer_name, sale_date, unit_price, is_baki, notes")
          .eq("owner_id", user.id)
          .order("sale_date", { ascending: false }),
      ]);

      if (productsRes.error || salesRes.error) {
        setToast({ type: "error", message: "Failed to load sales data." });
        setProducts([]);
        setSales([]);
        return;
      }

      setProducts((productsRes.data ?? []) as Product[]);
      setSales((salesRes.data ?? []) as SaleLogRow[]);
    } catch {
      setToast({ type: "error", message: "Failed to load sales data." });
      setProducts([]);
      setSales([]);
    } finally {
      setIsLoading(false);
    }
  }

  const matchingProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 10);
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10);
  }, [productSearch, products]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.name === form.product_name) ?? null,
    [form.product_name, products]
  );

  const productUnitMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) {
      map.set(product.name.toLowerCase(), product.unit || "pcs");
    }
    return map;
  }, [products]);

  async function handleCreateSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProduct) {
      setToast({ type: "error", message: "Please select a valid product." });
      return;
    }

    const qty = Number(form.qty_sold);
    const unitPrice = Number(form.unit_price);
    if (!qty || qty <= 0) {
      setToast({ type: "error", message: "Quantity sold must be greater than 0." });
      return;
    }
    if (qty > selectedProduct.stock_qty) {
      setToast({
        type: "error",
        message: `Not enough stock. Available: ${selectedProduct.stock_qty} ${selectedProduct.unit}.`,
      });
      return;
    }
    if (!unitPrice || unitPrice <= 0) {
      setToast({ type: "error", message: "Unit price must be greater than 0." });
      return;
    }
    if (form.is_baki && !form.customer_name.trim()) {
      setToast({ type: "error", message: "Customer name is required for baki sales." });
      return;
    }

    setIsSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to record a sale." });
      setIsSaving(false);
      return;
    }

    const saleDateTime = `${form.sale_date}T00:00:00.000Z`;
    const totalAmount = qty * unitPrice;

    const saleInsert = await supabase
      .from("sales_log")
      .insert({
        owner_id: user.id,
        product_name: selectedProduct.name,
        qty_sold: qty,
        customer_name: form.customer_name.trim()
          ? sanitizeCustomerName(form.customer_name)
          : null,
        sale_date: saleDateTime,
        unit_price: unitPrice,
        is_baki: form.is_baki,
        notes: form.notes.trim() ? sanitizeNotes(form.notes) : null,
      })
      .select("id, product_name, qty_sold, customer_name, sale_date, unit_price, is_baki, notes")
      .single();

    if (saleInsert.error) {
      setToast({ type: "error", message: "Failed to record sale." });
      setIsSaving(false);
      return;
    }

    const stockUpdate = await supabase
      .from("products")
      .update({ stock_qty: selectedProduct.stock_qty - qty })
      .eq("owner_id", user.id)
      .eq("id", selectedProduct.id);

    if (stockUpdate.error) {
      setToast({ type: "error", message: "Sale saved but stock update failed." });
      setIsSaving(false);
      return;
    }

    if (form.is_baki) {
      const customer = sanitizeCustomerName(form.customer_name);
      const existing = await supabase
        .from("baki")
        .select("id, amount_owed")
        .eq("owner_id", user.id)
        .ilike("customer_name", customer)
        .limit(1)
        .maybeSingle();

      if (existing.error) {
        setToast({ type: "error", message: "Sale saved, but baki lookup failed." });
        setIsSaving(false);
        return;
      }

      if (existing.data) {
        const updateBaki = await supabase
          .from("baki")
          .update({
            amount_owed: Number(existing.data.amount_owed) + totalAmount,
            last_updated: new Date().toISOString(),
          })
          .eq("owner_id", user.id)
          .eq("id", existing.data.id);

        if (updateBaki.error) {
          setToast({ type: "error", message: "Sale saved, but baki update failed." });
          setIsSaving(false);
          return;
        }
      } else {
        const createBaki = await supabase.from("baki").insert({
          owner_id: user.id,
          customer_name: customer,
          amount_owed: totalAmount,
          last_updated: new Date().toISOString(),
          notes: "Auto-created from sale log.",
        });

        if (createBaki.error) {
          setToast({ type: "error", message: "Sale saved, but baki entry creation failed." });
          setIsSaving(false);
          return;
        }
      }
    }

    const newSale = saleInsert.data as SaleLogRow;
    setSales((prev) => [newSale, ...prev]);
    setProducts((prev) =>
      prev.map((p) => (p.id === selectedProduct.id ? { ...p, stock_qty: p.stock_qty - qty } : p))
    );

    setForm({ ...emptyForm, sale_date: todayIsoDate() });
    setProductSearch("");
    setShowProductDropdown(false);
    setToast({ type: "success", message: "Sale recorded successfully" });
    setIsSaving(false);
  }

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const dateOnly = sale.sale_date.slice(0, 10);
      const inStart = startDate ? dateOnly >= startDate : true;
      const inEnd = endDate ? dateOnly <= endDate : true;
      const productMatch = productFilter.trim()
        ? sale.product_name.toLowerCase().includes(productFilter.trim().toLowerCase())
        : true;
      return inStart && inEnd && productMatch;
    });
  }, [sales, startDate, endDate, productFilter]);

  const groupedSales = useMemo(() => {
    const groups = new Map<string, SaleLogRow[]>();
    for (const sale of filteredSales) {
      const dateOnly = sale.sale_date.slice(0, 10);
      const list = groups.get(dateOnly) ?? [];
      list.push(sale);
      groups.set(dateOnly, list);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filteredSales]);

  function exportCsv() {
    const header = ["Date", "Product", "Qty", "Unit Price", "Total", "Customer", "Type"];
    const rows = filteredSales.map((sale) => {
      const total = (sale.unit_price ?? 0) * sale.qty_sold;
      return [
        sale.sale_date.slice(0, 10),
        sale.product_name,
        String(sale.qty_sold),
        String(sale.unit_price ?? 0),
        String(total),
        sale.customer_name ?? "",
        sale.is_baki ? "Baki" : "Cash",
      ];
    });

    const csvContent = [header, ...rows]
      .map((cols) =>
        cols.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-log-${todayIsoDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function generateInvoicePdf(sale: SaleLogRow) {
    // Customer-facing PDF: unit/total only — never include cost_price or profit margin.
    const { jsPDF } = await import("jspdf");
    const saleDate = sale.sale_date.slice(0, 10);
    const invoiceNo = `SS-${sale.id}-${saleDate}`;
    const unit = productUnitMap.get(sale.product_name.toLowerCase()) ?? "pcs";
    const unitPrice = sale.unit_price ?? 0;
    const total = unitPrice * sale.qty_sold;
    const customer = sale.customer_name?.trim() || "Walk-in";
    const paymentType = sale.is_baki ? "Baki" : "Cash";

    const doc = new jsPDF({ unit: "mm", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("SmartShodhai", 14, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("আপনার বিশ্বস্ত ব্যবসায়িক সহায়ক", 14, 28);

    doc.setFontSize(10);
    doc.text(`Date: ${saleDate}`, 14, 36);
    doc.text(`Invoice #: ${invoiceNo}`, 140, 36);

    doc.setDrawColor(200);
    doc.line(14, 40, 196, 40);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Product Name", 14, 48);
    doc.text("Quantity", 80, 48);
    doc.text("Unit", 108, 48);
    doc.text("Unit Price (৳)", 126, 48);
    doc.text("Total (৳)", 170, 48);
    doc.line(14, 51, 196, 51);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(sale.product_name, 14, 58);
    doc.text(String(sale.qty_sold), 82, 58);
    doc.text(unit, 108, 58);
    doc.text(unitPrice.toFixed(2), 133, 58);
    doc.text(total.toFixed(2), 174, 58);
    doc.line(14, 62, 196, 62);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Total Amount: ${formatCurrencyBDT(total)}`, 14, 74);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Payment Type: ${paymentType}`, 14, 82);
    if (sale.customer_name) {
      doc.text(`Customer: ${sale.customer_name}`, 14, 89);
    }

    doc.setFont("helvetica", "bold");
    doc.text("Thank you for your business / ধন্যবাদ", 14, 102);

    const safeCustomer = sanitizeFileName(customer);
    doc.save(`Invoice_${safeCustomer}_${saleDate}.pdf`);
  }

  function printReceipt(sale: SaleLogRow) {
    const saleDate = sale.sale_date.slice(0, 10);
    const invoiceNo = `SS-${sale.id}-${saleDate}`;
    const unit = productUnitMap.get(sale.product_name.toLowerCase()) ?? "pcs";
    const unitPrice = sale.unit_price ?? 0;
    const total = unitPrice * sale.qty_sold;
    const paymentType = sale.is_baki ? "Baki" : "Cash";
    const customer = sale.customer_name?.trim() || "Walk-in";

    const printWindow = window.open("", "_blank", "width=420,height=800");
    if (!printWindow) {
      setToast({ type: "error", message: "Unable to open print window." });
      return;
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Receipt ${escapeHtml(invoiceNo)}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      body { margin: 0; font-family: Arial, sans-serif; color: #111827; }
      .receipt { width: 72mm; margin: 0 auto; font-size: 12px; }
      .center { text-align: center; }
      .title { font-size: 18px; font-weight: 700; margin: 4px 0; }
      .muted { color: #4b5563; font-size: 11px; }
      .sep { border-top: 1px dashed #9ca3af; margin: 8px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { padding: 3px 0; text-align: left; vertical-align: top; }
      th:last-child, td:last-child { text-align: right; }
      .total { font-weight: 700; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="center">
        <div class="title">SmartShodhai</div>
        <div class="muted">আপনার বিশ্বস্ত ব্যবসায়িক সহায়ক</div>
      </div>
      <div class="sep"></div>
      <div>Invoice: ${escapeHtml(invoiceNo)}</div>
      <div>Date: ${escapeHtml(saleDate)}</div>
      <div>Customer: ${escapeHtml(customer)}</div>
      <div>Payment: ${escapeHtml(paymentType)}</div>
      <div class="sep"></div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(sale.product_name)} (${sale.qty_sold} ${escapeHtml(unit)} x ${unitPrice.toFixed(
      2
    )})</td>
            <td>${total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <div class="sep"></div>
      <div class="total">Total: ${escapeHtml(formatCurrencyBDT(total))}</div>
      <div class="center" style="margin-top: 10px;">Thank you / ধন্যবাদ</div>
    </div>
    <script>
      window.onload = () => {
        window.print();
      };
    </script>
  </body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
        <h2 className="mb-4 text-lg font-semibold text-indigo-700">New Sale</h2>
        <form onSubmit={handleCreateSale} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="relative md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Product</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={productSearch || form.product_name}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setForm((prev) => ({ ...prev, product_name: "" }));
                  setShowProductDropdown(true);
                }}
                onFocus={() => setShowProductDropdown(true)}
                placeholder="Search product by name..."
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
              />
            </div>
            {showProductDropdown && (
              <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {matchingProducts.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">No matching products.</p>
                ) : (
                  matchingProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          product_name: p.name,
                          unit_price:
                            p.selling_price != null ? String(Number(p.selling_price)) : "",
                        }));
                        setProductSearch(p.name);
                        setShowProductDropdown(false);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      {p.name} ({p.stock_qty} {p.unit} in stock)
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Quantity Sold</span>
            <input
              type="number"
              min={1}
              value={form.qty_sold}
              onChange={(e) => setForm((prev) => ({ ...prev, qty_sold: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
            />
            {selectedProduct && (
              <span className="text-xs text-slate-500">
                Available stock: {selectedProduct.stock_qty} {selectedProduct.unit}
              </span>
            )}
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Unit Price (৳)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.unit_price}
              onChange={(e) => setForm((prev) => ({ ...prev, unit_price: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Customer Name (optional)</span>
            <input
              type="text"
              value={form.customer_name}
              onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Sale Date</span>
            <input
              type="date"
              value={form.sale_date}
              onChange={(e) => setForm((prev) => ({ ...prev, sale_date: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
            />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Notes (optional)</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
            />
          </label>

          <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-slate-700">Is Baki?</p>
              <p className="text-xs text-slate-500">
                {form.is_baki ? "Will add amount to customer baki." : "Will record as cash sale."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, is_baki: !prev.is_baki }))}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                form.is_baki ? "bg-indigo-600" : "bg-slate-300"
              }`}
              aria-label="Toggle baki"
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                  form.is_baki ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Sale"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Product Name</span>
              <input
                type="text"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                placeholder="Filter product..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[860px] divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Product
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Unit Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr className="animate-pulse">
                  <td colSpan={8} className="px-4 py-8">
                    <div className="space-y-2">
                      <div className="loading-skeleton h-4 w-full" />
                      <div className="loading-skeleton h-4 w-10/12" />
                      <div className="loading-skeleton h-4 w-8/12" />
                    </div>
                  </td>
                </tr>
              ) : groupedSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-7 w-7 text-slate-400" />
                      <p>No sales recorded today</p>
                    </div>
                  </td>
                </tr>
              ) : (
                groupedSales.map(([dateKey, items]) => {
                  const dailyTotal = items.reduce(
                    (sum, sale) => sum + (sale.unit_price ?? 0) * sale.qty_sold,
                    0
                  );
                  return (
                    <Fragment key={dateKey}>
                      {items.map((sale) => (
                        <tr key={sale.id}>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {dayFormatter.format(new Date(sale.sale_date))}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-slate-700">
                            {sale.product_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{sale.qty_sold}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {formatCurrencyBDT(sale.unit_price ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-indigo-700">
                            {formatCurrencyBDT((sale.unit_price ?? 0) * sale.qty_sold)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {sale.customer_name || "-"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                sale.is_baki
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {sale.is_baki ? "Baki" : "Cash"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void generateInvoicePdf(sale)}
                                className="rounded-md border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                              >
                                Generate Invoice
                              </button>
                              <button
                                type="button"
                                onClick={() => printReceipt(sale)}
                                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Print Receipt
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr key={`daily-total-${dateKey}`} className="bg-slate-50">
                        <td
                          colSpan={4}
                          className="px-4 py-3 text-right text-sm font-semibold text-slate-700"
                        >
                          Daily Total ({dayFormatter.format(new Date(dateKey))})
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-indigo-700">
                          {formatCurrencyBDT(dailyTotal)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

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
    </div>
  );
}
