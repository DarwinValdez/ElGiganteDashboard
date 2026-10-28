import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS_LABELS, PO_STATUS_LABELS } from "@/lib/labels";
import type { InvoiceStatus, PoStatus } from "@/lib/types";

const PO_VARIANTS: Record<PoStatus, "muted" | "warning" | "default" | "secondary" | "success" | "destructive" | "outline"> = {
  draft: "muted",
  pending_approval: "warning",
  approved: "secondary",
  sent: "outline",
  partially_received: "warning",
  received: "success",
  cancelled: "destructive",
};

const INVOICE_VARIANTS: Record<InvoiceStatus, "muted" | "warning" | "default" | "secondary" | "success" | "destructive" | "outline"> = {
  uploaded: "muted",
  processing: "secondary",
  ocr_failed: "destructive",
  needs_review: "warning",
  confirmed: "success",
  voided: "outline",
};

export function PoStatusBadge({ status }: { status: PoStatus }) {
  return <Badge variant={PO_VARIANTS[status]}>{PO_STATUS_LABELS[status]}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={INVOICE_VARIANTS[status]} className={status === "voided" ? "line-through" : undefined}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "success" : "muted"}>{active ? "Activo" : "Inactivo"}</Badge>;
}

export function CostChangeBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <Badge variant="muted">Sin comparación</Badge>;
  const n = Number(pct);
  if (n > 0) return <Badge variant="destructive">▲ {n.toFixed(2)} %</Badge>;
  if (n < 0) return <Badge variant="success">▼ {Math.abs(n).toFixed(2)} %</Badge>;
  return <Badge variant="muted">= 0 %</Badge>;
}
