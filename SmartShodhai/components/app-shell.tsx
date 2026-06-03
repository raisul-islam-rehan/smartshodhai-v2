"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plus,
  Package,
  ScanLine,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearLegacyUserRoleCache } from "@/lib/user-role";
import { sanitizeCustomerName } from "@/lib/validation";

type NavItem = {
  label: string;
  mobileLabel?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", icon: Package },
  { label: "Baki / Credit", mobileLabel: "Baki", href: "/baki", icon: Users },
  { label: "Scan", href: "/scan", icon: ScanLine },
  { label: "Sales Log", href: "/sales", icon: ShoppingCart },
  { label: "AI Assistant", href: "/assistant", icon: MessageSquare },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [businessName, setBusinessName] = useState("");
  const [overdueBakiCount, setOverdueBakiCount] = useState(0);
  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false);
  const [quickSaleForm, setQuickSaleForm] = useState({
    product_name: "",
    qty_sold: "1",
    unit_price: "",
    customer_name: "",
    is_baki: false,
  });
  const [isQuickSaleSaving, setIsQuickSaleSaving] = useState(false);
  const isAuthPage = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (isAuthPage) return;

    async function loadProfile() {
      clearLegacyUserRoleCache();
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        const { data } = await supabase
          .from("profiles")
          .select("business_name, role")
          .eq("id", user.id)
          .maybeSingle();

        if (data?.business_name) {
          setBusinessName(data.business_name);
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("baki")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user.id)
          .gt("amount_owed", 0)
          .lt("last_updated", thirtyDaysAgo);
        setOverdueBakiCount(count ?? 0);
      } catch {
        setOverdueBakiCount(0);
      }
    }

    void loadProfile();
  }, [isAuthPage, supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    clearLegacyUserRoleCache();
    router.push("/login");
    router.refresh();
  }

  async function handleQuickSaleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickSaleForm.product_name.trim() || !quickSaleForm.qty_sold.trim()) return;

    setIsQuickSaleSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsQuickSaleSaving(false);
      return;
    }

    const qty = Number(quickSaleForm.qty_sold);
    const price = Number(quickSaleForm.unit_price || 0);
    const now = new Date().toISOString();

    const { data: product } = await supabase
      .from("products")
      .select("id, name, stock_qty")
      .eq("owner_id", user.id)
      .eq("name", quickSaleForm.product_name.trim())
      .maybeSingle();

    if (!product || qty <= 0 || qty > Number(product.stock_qty)) {
      setIsQuickSaleSaving(false);
      return;
    }

    const { error: saleErr } = await supabase.from("sales_log").insert({
      owner_id: user.id,
      product_name: quickSaleForm.product_name.trim(),
      qty_sold: qty,
      customer_name: quickSaleForm.customer_name.trim()
        ? sanitizeCustomerName(quickSaleForm.customer_name)
        : null,
      sale_date: now,
      unit_price: price > 0 ? price : null,
      is_baki: quickSaleForm.is_baki,
    });

    if (!saleErr) {
      await supabase
        .from("products")
        .update({ stock_qty: Number(product.stock_qty) - qty })
        .eq("owner_id", user.id)
        .eq("id", product.id);
    }

    setQuickSaleForm({
      product_name: "",
      qty_sold: "1",
      unit_price: "",
      customer_name: "",
      is_baki: false,
    });
    setIsQuickSaleOpen(false);
    setIsQuickSaleSaving(false);
    router.refresh();
  }

  if (isAuthPage) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-indigo-600 bg-indigo-700 text-white md:flex">
        <div className="border-b border-indigo-600 px-6 py-5">
          <p className="text-lg font-bold tracking-tight">
            SmartShodhai <span className="font-semibold">| স্মার্ট সহাই</span>
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-4 py-6">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-amber-300 text-indigo-900"
                    : "text-indigo-100 hover:bg-indigo-600 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
                {item.href === "/baki" && overdueBakiCount > 0 && (
                  <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                    {overdueBakiCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-indigo-600 p-4">
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-lg border border-indigo-500 px-3 py-2 text-sm font-medium text-indigo-100 transition hover:bg-indigo-600 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex h-16 items-center justify-between px-4 md:px-8">
            <div>
              <h1 className="text-lg font-bold text-indigo-700 md:text-xl">
                SmartShodhai <span className="font-semibold">স্মার্ট সহাই</span>
              </h1>
              {businessName && (
                <p className="text-xs font-medium text-slate-500">{businessName}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 md:hidden"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
        </header>

        <main className="px-4 pb-24 pt-6 md:px-8 md:pb-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden">
        <ul className="grid h-16 grid-cols-6">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                    isActive ? "text-indigo-700" : "text-slate-500"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="leading-none">{item.mobileLabel ?? item.label}</span>
                  {item.href === "/baki" && overdueBakiCount > 0 && (
                    <span className="absolute right-3 top-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {overdueBakiCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={() => setIsQuickSaleOpen(true)}
        className="fixed bottom-20 right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-700 text-white shadow-lg md:hidden"
        aria-label="Quick add sale"
      >
        <Plus className="h-6 w-6" />
      </button>

      {isQuickSaleOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden"
          onClick={() => setIsQuickSaleOpen(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Quick Sale Entry</h3>
              <button
                type="button"
                onClick={() => setIsQuickSaleOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close quick sale"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-3" onSubmit={(event) => void handleQuickSaleSubmit(event)}>
              <input
                type="text"
                placeholder="Product name"
                value={quickSaleForm.product_name}
                onChange={(event) =>
                  setQuickSaleForm((prev) => ({ ...prev, product_name: event.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={quickSaleForm.qty_sold}
                  onChange={(event) =>
                    setQuickSaleForm((prev) => ({ ...prev, qty_sold: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unit price (৳)"
                  value={quickSaleForm.unit_price}
                  onChange={(event) =>
                    setQuickSaleForm((prev) => ({ ...prev, unit_price: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <input
                type="text"
                placeholder="Customer (optional)"
                value={quickSaleForm.customer_name}
                onChange={(event) =>
                  setQuickSaleForm((prev) => ({ ...prev, customer_name: event.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() =>
                  setQuickSaleForm((prev) => ({
                    ...prev,
                    is_baki: !prev.is_baki,
                  }))
                }
                className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                  quickSaleForm.is_baki ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {quickSaleForm.is_baki ? "Baki Sale" : "Cash Sale"}
              </button>
              <button
                type="submit"
                disabled={isQuickSaleSaving}
                className="w-full rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isQuickSaleSaving ? "Saving..." : "Save Quick Sale"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
