/** Cálculos de factura compartidos por la pantalla de revisión (la BD vuelve a validarlos). */
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function expectedLineTotal(line: { quantity: unknown; unit_price: unknown; discount: unknown }) {
  return r2(num(line.quantity) * num(line.unit_price) - num(line.discount));
}

export function lineMismatch(line: { quantity: unknown; unit_price: unknown; discount: unknown; line_total: unknown }, tolerance = 0.01) {
  return Math.abs(expectedLineTotal(line) - num(line.line_total)) > Math.max(tolerance, 0.01);
}

export function invoiceTotals(
  h: { subtotal?: unknown; discount_total: unknown; tax_total: unknown; freight_total: unknown; other_charges: unknown; total?: unknown },
  lines: { line_total: unknown; tax?: unknown }[],
  tolerance: number,
) {
  const linesSum = r2(lines.reduce((a, l) => a + num(l.line_total), 0));
  const lineTax = r2(lines.reduce((a, l) => a + num(l.tax), 0));
  const computed = r2(linesSum - num(h.discount_total) + num(h.tax_total) + num(h.freight_total) + num(h.other_charges));
  const hasTotal = h.total !== "" && h.total !== null && h.total !== undefined;
  const hasSubtotal = h.subtotal !== "" && h.subtotal !== null && h.subtotal !== undefined;
  const totalDiff = hasTotal ? r2(num(h.total) - computed) : null;
  const subtotalDiff = hasSubtotal ? r2(num(h.subtotal) - linesSum) : null;
  const ok = totalDiff !== null && Math.abs(totalDiff) <= tolerance && (subtotalDiff === null || Math.abs(subtotalDiff) <= tolerance);
  return { linesSum, lineTax, computed, totalDiff, subtotalDiff, ok };
}
