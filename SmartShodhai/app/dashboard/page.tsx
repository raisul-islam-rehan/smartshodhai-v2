"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CircleDollarSign,
  PackageSearch,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { productsSelectQuery } from "@/lib/products-query";
import { formatCurrencyBDT, formatNumberBD } from "@/lib/format";
import { fetchUserRole, type UserRole } from "@/lib/user-role";
import type { BakiRecord, Product, SaleLog } from "@/types";

const DashboardCharts = dynamic(
  () => import("@/components/dashboard-charts").then((mod) => mod.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="loading-skeleton mb-4 h-4 w-40" />
          <div className="loading-skeleton h-72 w-full" />
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="loading-skeleton mb-4 h-4 w-48" />
          <div className="loading-skeleton h-72 w-full" />
        </div>
      </div>
    ),
  }
);

type KpiCardProps = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
};

type DailySalesPoint = {
  date: string;
  sales: number;
};

type ProductSalesPoint = {
  product: string;
  qty: number;
};

function KpiCard({ label, value, icon: Icon, accentClass }: KpiCardProps) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span
          className={`inline-flex rounded-lg p-2 ring-1 ring-inset ${accentClass}`}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="text-3xl font-bold text-indigo-700">{value}</p>
    </div>
  );
}

const compactDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  const day = clone.getDay();
  const distanceFromMonday = (day + 6) % 7;
  clone.setDate(clone.getDate() - distanceFromMonday);
  return clone;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getLastSevenDays(end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(end);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - i);
    dates.push(toIsoDate(day));
  }

  return dates;
}

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [salesLog, setSalesLog] = useState<SaleLog[]>([]);
  const [bakiRecords, setBakiRecords] = useState<BakiRecord[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      setIsLoading(true);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!isMounted) return;
          setProducts([]);
          setSalesLog([]);
          setBakiRecords([]);
          setIsLoading(false);
          return;
        }

        const role = await fetchUserRole(supabase, user.id);
        if (!isMounted) return;
        setUserRole(role);

        const [productsRes, salesRes, bakiRes] = await Promise.all([
          productsSelectQuery(supabase, user.id, role, "compact"),
          supabase
            .from("sales_log")
            .select("id, product_name, qty_sold, customer_name, sale_date, unit_price, is_baki")
            .eq("owner_id", user.id),
          supabase
            .from("baki")
            .select("id, customer_name, customer_phone, amount_owed, last_updated, notes")
            .eq("owner_id", user.id),
        ]);

        if (!isMounted) return;

        if (productsRes.error) {
          setProducts([]);
        } else {
          setProducts((productsRes.data ?? []) as Product[]);
        }

        if (salesRes.error) {
          setSalesLog([]);
        } else {
          setSalesLog((salesRes.data ?? []) as SaleLog[]);
        }

        if (bakiRes.error) {
          setBakiRecords([]);
        } else {
          setBakiRecords((bakiRes.data ?? []) as BakiRecord[]);
        }
      } catch {
        if (!isMounted) return;
        setProducts([]);
        setSalesLog([]);
        setBakiRecords([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  const dashboardData = useMemo(() => {
    const now = new Date();
    const todayDate = toIsoDate(now);
    const weekStartDate = toIsoDate(startOfWeek(now));

    const productByName = new Map(
      products.map((product) => [product.name.toLowerCase(), product])
    );

    const salesToday = salesLog.filter((sale) => toDateOnly(sale.sale_date) === todayDate);

    const dailySales = salesToday.reduce((sum, sale) => {
      const unitPrice = sale.unit_price ?? 0;
      return sum + unitPrice * sale.qty_sold;
    }, 0);

    const todaysProfit = salesToday.reduce((sum, sale) => {
      const product = productByName.get(sale.product_name.toLowerCase());
      if (!product) return sum;
      const margin = (product.selling_price ?? 0) - (product.cost_price ?? 0);
      return sum + margin * sale.qty_sold;
    }, 0);

    const totalBaki = bakiRecords.reduce((sum, record) => sum + record.amount_owed, 0);

    const lowStockItems = products.filter(
      (product) => product.stock_qty <= product.reorder_level
    );

    const recentDays = getLastSevenDays(now);
    const salesByDateMap = new Map(recentDays.map((day) => [day, 0]));

    for (const sale of salesLog) {
      const date = toDateOnly(sale.sale_date);
      if (!salesByDateMap.has(date)) continue;
      const amount = (sale.unit_price ?? 0) * sale.qty_sold;
      salesByDateMap.set(date, (salesByDateMap.get(date) ?? 0) + amount);
    }

    const salesByDay: DailySalesPoint[] = recentDays.map((date) => ({
      date: compactDate.format(new Date(date)),
      sales: salesByDateMap.get(date) ?? 0,
    }));

    const weeklyProductTotals = new Map<string, number>();
    for (const sale of salesLog) {
      const date = toDateOnly(sale.sale_date);
      if (date < weekStartDate || date > todayDate) continue;
      weeklyProductTotals.set(
        sale.product_name,
        (weeklyProductTotals.get(sale.product_name) ?? 0) + sale.qty_sold
      );
    }

    const topProductsThisWeek: ProductSalesPoint[] = Array.from(weeklyProductTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([product, qty]) => ({ product, qty }));

    return {
      dailySales,
      todaysProfit,
      totalBaki,
      lowStockItems,
      salesByDay,
      topProductsThisWeek,
    };
  }, [bakiRecords, products, salesLog]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div className="loading-skeleton mb-3 h-4 w-28" />
              <div className="loading-skeleton h-8 w-40" />
            </div>
          ))}
        </section>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="loading-skeleton h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Daily Sales"
          value={formatCurrencyBDT(dashboardData.dailySales, 0)}
          icon={BadgeDollarSign}
          accentClass="bg-emerald-50 text-emerald-600 ring-emerald-200"
        />
        {userRole === "owner" && (
          <KpiCard
            label="Today's Profit"
            value={formatCurrencyBDT(dashboardData.todaysProfit, 0)}
            icon={CircleDollarSign}
            accentClass="bg-green-50 text-green-600 ring-green-200"
          />
        )}
        <KpiCard
          label="Total Baki"
          value={formatCurrencyBDT(dashboardData.totalBaki, 0)}
          icon={AlertTriangle}
          accentClass="bg-red-50 text-red-600 ring-red-200"
        />
        <KpiCard
          label="Low Stock Items"
          value={formatNumberBD(dashboardData.lowStockItems.length)}
          icon={PackageSearch}
          accentClass="bg-orange-50 text-orange-600 ring-orange-200"
        />
      </section>

      <DashboardCharts
        salesByDay={dashboardData.salesByDay}
        topProductsThisWeek={dashboardData.topProductsThisWeek}
      />

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Low Stock Alerts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Product Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Current Stock
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Unit
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Reorder Level
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboardData.lowStockItems.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-sm text-slate-500" colSpan={4}>
                    No low stock alerts.
                  </td>
                </tr>
              ) : (
                dashboardData.lowStockItems.map((product) => {
                  const isOutOfStock = product.stock_qty === 0;

                  return (
                    <tr key={product.id} className={isOutOfStock ? "bg-red-50" : ""}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-700">
                        {product.name}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm ${
                          isOutOfStock ? "font-semibold text-red-700" : "text-slate-600"
                        }`}
                      >
                        {product.stock_qty}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{product.unit}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {product.reorder_level}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
