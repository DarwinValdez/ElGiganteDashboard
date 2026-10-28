"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";

/**
 * Paleta categórica validada (CVD y visión normal) con scripts/validate_palette.js.
 * Orden fijo: la serie N siempre usa el color N. El amarillo (#eda100) queda bajo
 * 3:1 de contraste, por eso cada gráfico va acompañado de una tabla con los datos.
 */
export const SERIES_COLORS = ["#1f7a44", "#2a78d6", "#eb6834", "#6250d6", "#eda100", "#e34948"];
const PRIMARY = SERIES_COLORS[0];
const AXIS = { fontSize: 12, fill: "#6b7280" };

function moneyTick(currency: string) {
  return (v: number) =>
    new Intl.NumberFormat("es", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function MonthlyPurchasesChart({ data, currency }: { data: { label: string; total: number; invoices: number }[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={moneyTick(currency)} width={64} />
        <Tooltip
          cursor={{ fill: "rgba(31,122,68,0.08)" }}
          formatter={(v, _n, item) => [`${formatMoney(Number(v), currency)} · ${item.payload.invoices} factura(s)`, "Compras"]}
        />
        <Bar dataKey="total" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SupplierPurchasesChart({ data, currency }: { data: { name: string; total: number }[]; currency: string }) {
  const height = Math.max(160, data.length * 34 + 30);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="#e5e7eb" />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={moneyTick(currency)} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={120} />
        <Tooltip cursor={{ fill: "rgba(31,122,68,0.08)" }} formatter={(v) => [formatMoney(Number(v), currency), "Compras"]} />
        <Bar dataKey="total" fill={PRIMARY} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Evolución del costo normalizado por proveedor (una línea por proveedor). */
export function PriceHistoryChart({
  points,
  currency,
  unit,
}: {
  points: { date: string; supplier: string; cost: number }[];
  currency: string;
  unit: string;
}) {
  const suppliers = Array.from(new Set(points.map((p) => p.supplier)));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row[p.supplier] = p.cost;
    byDate.set(p.date, row);
  }
  const data = Array.from(byDate.values());
  const visible = suppliers.slice(0, SERIES_COLORS.length);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={70}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => formatMoney(v, currency, v < 1 ? 4 : 2)}
        />
        <Tooltip
          labelFormatter={(d) => `Fecha: ${String(d).split("-").reverse().join("/")}`}
          formatter={(v, name) => [`${formatMoney(Number(v), currency, Number(v) < 1 ? 4 : 2)} / ${unit}`, name]}
        />
        {visible.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {visible.map((s, i) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={SERIES_COLORS[i]}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            activeDot={{ r: 6 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
