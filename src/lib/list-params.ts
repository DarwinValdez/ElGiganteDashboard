export type SearchParams = Record<string, string | string[] | undefined>;

export function sp(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export interface ListParams {
  q?: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  from: number;
  to: number;
}

/** Lee búsqueda, orden y paginación desde la URL (listas filtrables y compartibles). */
export function parseListParams(
  params: SearchParams,
  opts: { sortable: string[]; defaultSort: string; defaultDir?: "asc" | "desc"; pageSize?: number },
): ListParams {
  const pageSize = opts.pageSize ?? 20;
  const page = Math.max(1, Number.parseInt(sp(params, "page") ?? "1", 10) || 1);
  const sortRaw = sp(params, "sort");
  const sort = sortRaw && opts.sortable.includes(sortRaw) ? sortRaw : opts.defaultSort;
  const dirRaw = sp(params, "dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.defaultDir ?? "asc");
  const q = sp(params, "q")?.trim().slice(0, 100);
  return { q, page, pageSize, sort, dir, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

/** Escapa comodines para filtros ilike de PostgREST. */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[%_\\,()]/g, " ").trim()}%`;
}

export function buildHref(base: string, params: SearchParams, patch: Record<string, string | number | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) usp.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") usp.delete(k);
    else usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `${base}?${s}` : base;
}

export function dateRange(params: SearchParams, defaultDays = 30): { from: string; to: string } {
  const today = new Date();
  const to = sp(params, "to") ?? today.toISOString().slice(0, 10);
  const def = new Date(today);
  def.setUTCDate(def.getUTCDate() - defaultDays);
  const from = sp(params, "from") ?? def.toISOString().slice(0, 10);
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: valid(from) ? from : def.toISOString().slice(0, 10), to: valid(to) ? to : today.toISOString().slice(0, 10) };
}
