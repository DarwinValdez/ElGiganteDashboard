const dateFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" });

export function formatMoney(value: number | string | null | undefined, currency = "USD", digits = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: Math.max(digits, 2),
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

/** Costos unitarios: hasta 4 decimales. */
export function formatCost(value: number | string | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const digits = Math.abs(n) < 1 && n !== 0 ? 4 : 2;
  return formatMoney(n, currency, digits);
}

export function formatNumber(value: number | string | null | undefined, maxDigits = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es", { maximumFractionDigits: maxDigits }).format(n);
}

export function formatPct(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)} %`;
}

/** Fechas tipo `date` (YYYY-MM-DD) se muestran sin desplazamiento de zona horaria. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateTimeFmt.format(d);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
