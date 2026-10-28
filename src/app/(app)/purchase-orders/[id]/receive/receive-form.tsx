"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { createGoodsReceipt } from "@/app/(app)/purchase-orders/actions";
import { ProductPicker } from "@/components/common/product-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatNumber } from "@/lib/format";

export interface ReceiveLine {
  key: string;
  purchase_order_item_id?: string;
  product_id: string;
  product_name: string;
  ordered_quantity: number;
  already_received: number;
  received_quantity: string;
  unit: string;
  conversion_factor: number;
  ordered_unit_price: number | null;
  unit_price: string;
  is_extra: boolean;
  difference_reason: string;
}

export function ReceiveForm({ poId, lines: initial, currency, inventorySource }: { poId: string; lines: ReceiveLine[]; currency: string; inventorySource: string }) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const upd = (key: string, patch: Partial<ReceiveLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const issues = lines.filter((l) => {
    const pendingQty = l.ordered_quantity - l.already_received;
    const rec = Number(l.received_quantity || 0);
    const priceChanged = l.ordered_unit_price !== null && l.unit_price !== "" && Number(l.unit_price) !== Number(l.ordered_unit_price);
    return (!l.is_extra && rec !== pendingQty) || priceChanged || l.is_extra;
  });
  const missingReason = issues.filter((l) => !l.difference_reason.trim());

  const submit = () =>
    start(async () => {
      const res = await createGoodsReceipt({
        purchase_order_id: poId,
        received_at: receivedAt,
        notes,
        items: lines.map((l) => ({
          purchase_order_item_id: l.purchase_order_item_id ?? "",
          product_id: l.product_id,
          ordered_quantity: l.is_extra ? 0 : l.ordered_quantity - l.already_received,
          received_quantity: l.received_quantity || "0",
          unit: l.unit,
          conversion_factor: l.conversion_factor,
          ordered_unit_price: l.ordered_unit_price ?? "",
          unit_price: l.unit_price,
          is_extra: l.is_extra,
          difference_reason: l.difference_reason,
        })),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.push(`/purchase-orders/${poId}`);
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <Alert>
        <AlertDescription>
          Compare lo solicitado con lo recibido. Las diferencias de cantidad o precio requieren un motivo.{" "}
          {inventorySource === "receipt"
            ? "Según la configuración, esta recepción generará las entradas de inventario."
            : "Según la configuración, las entradas de inventario se generan al confirmar la factura (la recepción no duplica existencias)."}
        </AlertDescription>
      </Alert>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead>Recibido</TableHead>
              <TableHead>Precio facturado</TableHead>
              <TableHead>Motivo de diferencia</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const pendingQty = l.ordered_quantity - l.already_received;
              const rec = Number(l.received_quantity || 0);
              const diff = l.is_extra ? null : rec - pendingQty;
              return (
                <TableRow key={l.key}>
                  <TableCell className="min-w-56 whitespace-normal">
                    {l.is_extra && !l.product_id ? (
                      <ProductPicker
                        value={null}
                        onSelect={(p) =>
                          upd(l.key, {
                            product_id: p.id,
                            product_name: p.name,
                            unit: p.purchase_unit,
                            conversion_factor: Number(p.units_per_package),
                            unit_price: p.last_purchase_price !== null ? String(p.last_purchase_price) : "",
                          })
                        }
                      />
                    ) : (
                      <>
                        {l.product_name} {l.is_extra ? <Badge variant="secondary">Adicional</Badge> : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.is_extra ? "—" : `${formatNumber(pendingQty)} ${l.unit}`}
                    {diff !== null && diff !== 0 ? (
                      <div>
                        <Badge variant="warning">{diff > 0 ? "+" : ""}{formatNumber(diff)}</Badge>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input inputMode="decimal" className="w-24" value={l.received_quantity} onChange={(e) => upd(l.key, { received_quantity: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input inputMode="decimal" className="w-28" value={l.unit_price} onChange={(e) => upd(l.key, { unit_price: e.target.value })} />
                    {l.ordered_unit_price !== null ? <div className="text-xs text-muted-foreground">Pedido: {formatMoney(l.ordered_unit_price, currency)}</div> : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="min-w-48"
                      placeholder="Faltante, dañado, cambio de precio…"
                      value={l.difference_reason}
                      aria-invalid={missingReason.some((m) => m.key === l.key)}
                      onChange={(e) => upd(l.key, { difference_reason: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    {l.is_extra ? (
                      <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar">
                        <Trash2 className="text-destructive" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: crypto.randomUUID(),
                  product_id: "",
                  product_name: "",
                  ordered_quantity: 0,
                  already_received: 0,
                  received_quantity: "",
                  unit: "unidad",
                  conversion_factor: 1,
                  ordered_unit_price: null,
                  unit_price: "",
                  is_extra: true,
                  difference_reason: "Producto no solicitado",
                },
              ])
            }
          >
            <Plus /> Producto adicional
          </Button>
        </div>
      </Card>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Fecha de recepción</Label>
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Observaciones</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        {missingReason.length ? <p className="self-center text-sm text-destructive">Indique el motivo de {missingReason.length} diferencia(s).</p> : null}
        <Button onClick={submit} disabled={pending || missingReason.length > 0 || lines.some((l) => !l.product_id)}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Confirmar recepción
        </Button>
      </div>
    </div>
  );
}
