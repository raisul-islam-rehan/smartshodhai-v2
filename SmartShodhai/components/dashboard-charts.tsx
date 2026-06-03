"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrencyBDT } from "@/lib/format";

type DailySalesPoint = {
  date: string;
  sales: number;
};

type ProductSalesPoint = {
  product: string;
  qty: number;
};

type DashboardChartsProps = {
  salesByDay: DailySalesPoint[];
  topProductsThisWeek: ProductSalesPoint[];
};

export function DashboardCharts({
  salesByDay,
  topProductsThisWeek,
}: DashboardChartsProps) {
  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Sales (Last 7 Days)</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={salesByDay}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `৳${Math.round(value / 1000)}k`}
              />
              <Tooltip formatter={(value) => formatCurrencyBDT(Number(value ?? 0), 0)} />
              <Bar dataKey="sales" fill="#4f46e5" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Top Products This Week</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topProductsThisWeek}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 20, bottom: 8 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="product"
                width={140}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip formatter={(value) => `${Number(value ?? 0)} units`} />
              <Bar dataKey="qty" radius={[0, 8, 8, 0]}>
                {topProductsThisWeek.map((entry) => (
                  <Cell
                    key={entry.product}
                    fill={entry.qty > 0 ? "#f59e0b" : "#e2e8f0"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
