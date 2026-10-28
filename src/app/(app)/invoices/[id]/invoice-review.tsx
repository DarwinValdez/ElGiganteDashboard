"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Ban,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { confirmInvoice, saveInvoiceReview, suggestLineMatches, voidInvoice } from "@/app/(app)/invoices/actions";
import { runOcr } from "@/app/(app)/invoices/[id]/processing-panel";
import { ProductForm, type CreatedProduct } from "@/app/(app)/products/product-form";
import { SupplierForm } from "@/app/(app)/suppliers/supplier-form";
import { ConfirmAction } from "@/components/common/confirm-action";
import { Field } from "@/components/common/field";
import { ProductPicker } from "@/components/common/product-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Lookups } from "@/lib/data";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { expectedLineTotal, invoiceTotals, lineMismatch } from "@/lib/invoice-math";
import { MATCH_METHOD_LABELS } from "@/lib/labels";
import type { MatchCandidate } from "@/lib/matching";
import type { Invoice, InvoiceItem, InvoiceValidation, MatchMethod, OcrWarning } from "@/lib/types";
import { normalizeText, parsePackageCount, proposeConversion } from "@/lib/units";
import { invoiceReviewSchema, type InvoiceReviewInput, type InvoiceReviewValues } from "@/lib/validations";

export interface ProductInfo {
  id: string;
  name: string;
  sku: string;
  purchase_unit: string;
  inventory_unit: string;
  units_per_package: number;
}

type Form = UseFormReturn<InvoiceReviewInput, unknown, InvoiceReviewValues>;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function toFormValues(inv: Invoice, items: InvoiceItem[]): InvoiceReviewInput {
  return {
    supplier_id: s(inv.supplier_id),
    supplier_name_raw: s(inv.supplier_name_raw),
    invoice_number: s(inv.invoice_number),
    issue_date: s(inv.issue_date),
    due_date: s(inv.due_date),
    po_number_raw: s(inv.po_number_raw),
    purchase_order_id: s(inv.purchase_order_id),
    currency: inv.currency,
    subtotal: s(inv.subtotal),
    discount_total: s(inv.discount_total),
    tax_total: s(inv.tax_total),
    freight_total: s(inv.freight_total),
    other_charges: s(inv.other_charges),
    total: s(inv.total),
    payment_terms: s(inv.payment_terms),
    notes: s(inv.notes),
    items: items.map((i) => ({
      supplier_code: s(i.supplier_code),
      original_description: i.original_description,
      product_id: s(i.product_id),
      match_method: s(i.match_method),
      match_score: s(i.match_score),
      match_confirmed: i.match_confirmed,
      brand: s(i.brand),
      quantity: s(i.quantity),
      unit: s(i.unit),
      unit_raw: s(i.unit_raw),
      package_description: s(i.package_description),
      conversion_factor: s(i.conversion_factor),
      unit_price: s(i.unit_price),
      discount: s(i.discount),
      tax: s(i.tax),
      line_total: s(i.line_total),
      ocr_confidence: s(i.ocr_confidence),
      review_note: s(i.review_note),
    })),
  };
}

export function InvoiceReview({
  invoice,
  items,
  products: initialProducts,
  candidates: initialCandidates,
  validation,
  lookups,
  purchaseOrders,
  supplierTerms,
  tolerance,
  isAdmin,
  ocrConfigured,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  products: Record<string, ProductInfo>;
  candidates: MatchCandidate[][];
  validation: InvoiceValidation | null;
  lookups: Lookups;
  purchaseOrders: { id: string; po_number: string; supplier_id: string; order_date: string; total: number }[];
  supplierTerms: Record<string, number | null>;
  tolerance: number;
  isAdmin: boolean;
  ocrConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [products, setProducts] = useState(initialProducts);
  const [candidates, setCandidates] = useState<MatchCandidate[][]>(initialCandidates);
  const [suppliers, setSuppliers] = useState(lookups.suppliers);
  const [createFor, setCreateFor] = useState<number | null>(null);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [exceptionNote, setExceptionNote] = useState("");
  const form: Form = useForm<InvoiceReviewInput, unknown, InvoiceReviewValues>({
    resolver: zodResolver(invoiceReviewSchema),
    defaultValues: toFormValues(invoice, items),
  });
  const { register, control, watch, setValue, handleSubmit, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const values = watch();
  const totals = invoiceTotals(values, values.items, tolerance);
  const unmatched = values.items.filter((i) => !i.product_id || !i.match_confirmed).length;
  const mismatchedLines = values.items.filter((i) => lineMismatch(i)).length;
  const totalsOk = totals.ok && mismatchedLines === 0;
  const supplierId = s(values.supplier_id);
  const cur = s(values.currency) || "USD";
  const warnings = (invoice.warnings ?? []) as OcrWarning[];
  const dirty = formState.isDirty;

  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!supplierId) b.push("Seleccione el proveedor");
    if (!s(values.invoice_number)) b.push("Indique el número de factura");
    if (!s(values.issue_date)) b.push("Indique la fecha de emisión");
    if (!s(values.total)) b.push("Indique el total impreso");
    if (!values.items.length) b.push("Agregue al menos una línea");
    if (unmatched) b.push(`${unmatched} línea(s) sin producto confirmado`);
    if (values.items.some((i) => Number(i.quantity) <= 0)) b.push("Hay cantidades en cero o negativas");
    return b;
  }, [supplierId, values, unmatched]);

  const exceptionRequired = !totalsOk;
  const canConfirm = blockers.length === 0 && (!exceptionRequired || (isAdmin && exceptionNote.trim().length >= 10));

  const save = handleSubmit((v) =>
    start(async () => {
      const res = await saveInvoiceReview(invoice.id, v);
      if (res.ok) {
        toast.success(res.message);
        form.reset(form.getValues());
        router.refresh();
      } else toast.error(res.error);
    }),
  );

  const confirm = handleSubmit((v) =>
    start(async () => {
      const res = await confirmInvoice(invoice.id, v, exceptionRequired ? exceptionNote : undefined);
      if (res.ok) {
        toast.success(`${res.message} (${res.data?.cost_rows ?? 0} costos, ${res.data?.movement_rows ?? 0} movimientos)`);
        router.refresh();
      } else toast.error(res.error, { duration: 10000 });
    }),
  );

  const applyProduct = (i: number, p: ProductInfo, method: MatchMethod, score: number | null, confirmed: boolean) => {
    setProducts((m) => ({ ...m, [p.id]: p }));
    const line = form.getValues(`items.${i}`);
    setValue(`items.${i}.product_id`, p.id, { shouldDirty: true });
    setValue(`items.${i}.match_method`, method, { shouldDirty: true });
    setValue(`items.${i}.match_score`, score === null ? "" : String(score), { shouldDirty: true });
    setValue(`items.${i}.match_confirmed`, confirmed, { shouldDirty: true });
    const conv = proposeConversion(s(line.unit) || null, p, lookups.units, parsePackageCount(s(line.package_description) || s(line.original_description)));
    setValue(`items.${i}.conversion_factor`, String(conv.factor), { shouldDirty: true });
    if (!s(line.unit)) setValue(`items.${i}.unit`, p.purchase_unit, { shouldDirty: true });
    if (!conv.certain) toast.info(`Línea ${i + 1}: ${conv.reason}`);
  };

  const refreshSuggestions = () =>
    start(async () => {
      try {
        const lines = form.getValues("items");
        const res = await suggestLineMatches(
          supplierId || null,
          lines.map((l) => ({
            supplier_code: s(l.supplier_code) || null,
            description: s(l.original_description),
            brand: s(l.brand) || null,
            unit: s(l.unit) || null,
            package_description: s(l.package_description) || null,
          })),
        );
        setCandidates(res.map((r) => r.candidates));
        let applied = 0;
        res.forEach((r, i) => {
          if (!s(lines[i].product_id) && r.product_id) {
            const c = r.candidates[0];
            applyProduct(i, { id: c.product_id, name: c.name, sku: c.sku, purchase_unit: c.purchase_unit, inventory_unit: c.inventory_unit, units_per_package: c.units_per_package }, r.method!, r.score, r.confirmed);
            applied++;
          }
        });
        toast.success(`Sugerencias actualizadas (${applied} línea(s) vinculadas)`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });

  const suggestedDue = () => {
    const days = supplierTerms[supplierId];
    const issue = s(values.issue_date);
    if (!days || !issue) return null;
    const d = new Date(`${issue}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const due = suggestedDue();

  return (
    <div className="grid gap-4">
      {invoice.status === "ocr_failed" ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>El reconocimiento automático falló</AlertTitle>
          <AlertDescription>
            <p>{invoice.ocr_error}</p>
            <p>Puede reintentar el OCR o completar los datos manualmente y guardar.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {warnings.length ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Advertencias del reconocimiento ({warnings.length})</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>
                  <strong>{w.field}:</strong> {w.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {validation?.duplicates?.length ? (
        <Alert variant={validation.duplicates.some((d) => d.status === "confirmed") ? "destructive" : "warning"}>
          <AlertTriangle />
          <AlertTitle>Posible factura duplicada</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {validation.duplicates.map((d) => (
                <li key={d.id + d.reason}>
                  <Link href={`/invoices/${d.id}`} className="underline" target="_blank">
                    {d.invoice_number ?? "(sin número)"}
                  </Link>{" "}
                  · {formatDate(d.issue_date)} · {formatMoney(d.total, cur)} · {d.reason} ({d.status})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Datos generales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Datos generales
            {invoice.ocr_confidence !== null ? <ConfidenceBadge value={invoice.ocr_confidence} label="OCR" /> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Proveedor" required className="sm:col-span-2" hint={s(values.supplier_name_raw) ? `En la factura: "${s(values.supplier_name_raw)}"` : undefined}>
            <div className="flex gap-2">
              <NativeSelect {...register("supplier_id")} aria-invalid={!supplierId}>
                <option value="">Seleccione…</option>
                {suppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.trade_name}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="outline" size="icon" onClick={() => setSupplierDialog(true)} aria-label="Registrar proveedor">
                <UserPlus />
              </Button>
            </div>
          </Field>
          <Field label="Número de factura" required>
            <Input {...register("invoice_number")} aria-invalid={!s(values.invoice_number)} />
          </Field>
          <Field label="Moneda">
            <Input {...register("currency")} maxLength={3} className="uppercase" />
          </Field>
          <Field label="Fecha de emisión" required>
            <Input type="date" {...register("issue_date")} aria-invalid={!s(values.issue_date)} />
          </Field>
          <Field label="Fecha de vencimiento">
            <div className="flex gap-2">
              <Input type="date" {...register("due_date")} />
              {due && due !== s(values.due_date) ? (
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setValue("due_date", due, { shouldDirty: true })}>
                  {formatDate(due)}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Orden de compra" hint={s(values.po_number_raw) ? `Impresa: ${s(values.po_number_raw)}` : undefined}>
            <NativeSelect {...register("purchase_order_id")}>
              <option value="">Sin orden</option>
              {purchaseOrders
                .filter((po) => !supplierId || po.supplier_id === supplierId)
                .map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_number} · {formatDate(po.order_date)} · {formatMoney(po.total, cur)}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Condiciones de pago">
            <Input {...register("payment_terms")} />
          </Field>
        </CardContent>
      </Card>

      {/* Líneas */}
      <Card className="gap-3">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Productos ({fields.length}){" "}
            {unmatched ? <Badge variant="warning">{unmatched} por vincular</Badge> : <Badge variant="success">Todas vinculadas</Badge>}
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={refreshSuggestions} disabled={pending || !fields.length}>
            <Sparkles /> Recalcular sugerencias
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {fields.map((f, i) => (
            <LineEditor
              key={f.id}
              index={i}
              form={form}
              product={products[s(values.items[i]?.product_id)] ?? null}
              candidates={candidates[i] ?? []}
              units={lookups.units}
              currency={cur}
              onPick={(p, method, score, confirmed) => applyProduct(i, p, method, score, confirmed)}
              onCreate={() => setCreateFor(i)}
              onRemove={() => {
                remove(i);
                setCandidates((c) => c.filter((_, j) => j !== i));
              }}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              append({
                supplier_code: "",
                original_description: "",
                product_id: "",
                match_method: "",
                match_score: "",
                match_confirmed: false,
                brand: "",
                quantity: "1",
                unit: "",
                unit_raw: "",
                package_description: "",
                conversion_factor: "1",
                unit_price: "0",
                discount: "0",
                tax: "0",
                line_total: "0",
                ocr_confidence: "",
                review_note: "",
              });
              setCandidates((c) => [...c, []]);
            }}
          >
            <Plus /> Agregar línea
          </Button>
        </CardContent>
      </Card>

      {/* Totales */}
      <Card>
        <CardHeader>
          <CardTitle>Totales y validación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subtotal impreso">
              <Input inputMode="decimal" {...register("subtotal")} />
            </Field>
            <Field label="Descuentos">
              <Input inputMode="decimal" {...register("discount_total")} />
            </Field>
            <Field label="Impuestos" hint={totals.lineTax ? `Suma de líneas: ${formatMoney(totals.lineTax, cur)}` : undefined}>
              <Input inputMode="decimal" {...register("tax_total")} />
            </Field>
            <Field label="Flete / transporte">
              <Input inputMode="decimal" {...register("freight_total")} />
            </Field>
            <Field label="Otros cargos">
              <Input inputMode="decimal" {...register("other_charges")} />
            </Field>
            <Field label="TOTAL impreso" required>
              <Input inputMode="decimal" {...register("total")} className="font-semibold" />
            </Field>
          </div>
          <div className="grid content-start gap-2 rounded-lg bg-muted/60 p-4 text-sm">
            <Row label="Suma de líneas" value={formatMoney(totals.linesSum, cur)} />
            {totals.subtotalDiff !== null ? (
              <Row label="Diferencia con subtotal impreso" value={formatMoney(totals.subtotalDiff, cur)} bad={Math.abs(totals.subtotalDiff) > tolerance} />
            ) : null}
            <Row label="Total calculado" value={formatMoney(totals.computed, cur)} hint="líneas − descuentos + impuestos + flete + otros" />
            <Row
              label="Diferencia con total impreso"
              value={totals.totalDiff === null ? "—" : formatMoney(totals.totalDiff, cur)}
              bad={totals.totalDiff === null || Math.abs(totals.totalDiff) > tolerance}
            />
            {mismatchedLines ? <Row label="Líneas con importe ≠ cantidad × precio − desc." value={String(mismatchedLines)} bad /> : null}
            <div className={`mt-2 flex items-center gap-2 font-medium ${totalsOk ? "text-success" : "text-destructive"}`}>
              {totalsOk ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
              {totalsOk ? `Los totales cuadran (tolerancia ${formatMoney(tolerance, cur)})` : "Los totales no cuadran: corrija los datos antes de confirmar"}
            </div>
          </div>
          <Field label="Notas internas" className="lg:col-span-2">
            <Textarea rows={2} {...register("notes")} />
          </Field>
        </CardContent>
      </Card>

      {/* Confirmación */}
      <Card className="border-primary/30">
        <CardContent className="grid gap-3">
          {blockers.length ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Pendiente antes de confirmar</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {exceptionRequired && blockers.length === 0 ? (
            isAdmin ? (
              <Field label="Justificación de la excepción (totales no cuadran)" hint="Obligatoria, mínimo 10 caracteres. Queda registrada en la auditoría.">
                <Textarea rows={2} value={exceptionNote} onChange={(e) => setExceptionNote(e.target.value)} />
              </Field>
            ) : (
              <p className="text-sm text-destructive">Los totales no cuadran. Corrija los datos o solicite a un administrador que documente la excepción.</p>
            )
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {invoice.file_path && ocrConfigured ? (
              <ConfirmAction
                trigger={
                  <Button type="button" variant="ghost" disabled={pending}>
                    <RefreshCw /> Reprocesar OCR
                  </Button>
                }
                title="Volver a procesar con OCR"
                description="Se reemplazarán los datos y líneas actuales por una nueva lectura del documento."
                confirmLabel="Reprocesar"
                action={async () => {
                  const r = await runOcr(invoice.id, true);
                  return r.ok ? { ok: true, message: "Factura procesada de nuevo" } : { ok: false, error: r.error ?? "Error" };
                }}
              />
            ) : null}
            <ConfirmAction
              trigger={
                <Button type="button" variant="ghost" className="text-destructive" disabled={pending}>
                  <Ban /> Descartar
                </Button>
              }
              title="Descartar factura"
              description="La factura se marca como anulada; el archivo y el historial se conservan."
              reasonLabel="Motivo"
              destructive
              confirmLabel="Descartar"
              action={(reason) => voidInvoice(invoice.id, reason)}
            />
            <Button type="button" variant="outline" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Guardar revisión
            </Button>
            <Button type="button" onClick={confirm} disabled={pending || !canConfirm}>
              {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar factura
            </Button>
          </div>
          {dirty ? <p className="text-right text-xs text-muted-foreground">Hay cambios sin guardar.</p> : null}
        </CardContent>
      </Card>

      <Dialog open={createFor !== null} onOpenChange={(o) => !o && setCreateFor(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Crear producto desde la línea {createFor !== null ? createFor + 1 : ""}</DialogTitle>
          </DialogHeader>
          {createFor !== null ? (
            <ProductForm
              compact
              lookups={{ ...lookups, suppliers }}
              initial={{
                name: s(values.items[createFor]?.original_description),
                brand: s(values.items[createFor]?.brand) || null,
                purchase_unit: s(values.items[createFor]?.unit) || "unidad",
                inventory_unit: "unidad",
                units_per_package: parsePackageCount(s(values.items[createFor]?.package_description) || s(values.items[createFor]?.original_description)) ?? 1,
                default_supplier_id: supplierId || null,
              }}
              onCreated={(p: CreatedProduct) => {
                applyProduct(createFor, { ...p, units_per_package: Number(p.units_per_package) }, "created", 1, true);
                setCreateFor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar proveedor</DialogTitle>
          </DialogHeader>
          <SupplierForm
            initialName={s(values.supplier_name_raw)}
            onCreated={(sup) => {
              setSuppliers((l) => [...l, sup].sort((a, b) => a.trade_name.localeCompare(b.trade_name)));
              setValue("supplier_id", sup.id, { shouldDirty: true });
              setSupplierDialog(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={`tabular-nums font-medium ${bad ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

function ConfidenceBadge({ value, label }: { value: number | string | null | undefined; label?: string }) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  const variant = n >= 0.9 ? "success" : n >= 0.75 ? "secondary" : "warning";
  return (
    <Badge variant={variant} title="Confianza del reconocimiento">
      {label ? `${label} ` : ""}
      {(n * 100).toFixed(0)} %
    </Badge>
  );
}

function LineEditor({
  index: i,
  form,
  product,
  candidates,
  units,
  currency,
  onPick,
  onCreate,
  onRemove,
}: {
  index: number;
  form: Form;
  product: ProductInfo | null;
  candidates: MatchCandidate[];
  units: Lookups["units"];
  currency: string;
  onPick: (p: ProductInfo, method: MatchMethod, score: number | null, confirmed: boolean) => void;
  onCreate: () => void;
  onRemove: () => void;
}) {
  const { register, watch, setValue } = form;
  const line = watch(`items.${i}`);
  const expected = expectedLineTotal(line);
  const mismatch = lineMismatch(line);
  const conf = line.ocr_confidence === "" ? null : Number(line.ocr_confidence);
  const lowConf = conf !== null && conf < 0.75;
  const method = s(line.match_method) as MatchMethod | "";
  const factor = Number(line.conversion_factor) || 0;
  const confirmed = !!line.match_confirmed;
  const others = candidates.filter((c) => c.product_id !== s(line.product_id)).slice(0, 4);
  const sameName = product && normalizeText(product.name) === normalizeText(s(line.original_description));

  return (
    <div className={`grid gap-3 rounded-lg border p-3 ${!confirmed ? "border-warning/60 bg-warning/5" : ""} ${lowConf ? "ring-1 ring-warning" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2 text-xs font-semibold text-muted-foreground">#{i + 1}</span>
        <div className="min-w-0 flex-1">
          <Input {...register(`items.${i}.original_description`)} className="font-medium" aria-label="Descripción original del proveedor" />
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>Descripción original del proveedor (se conserva)</span>
            <ConfidenceBadge value={conf} label="OCR" />
            {s(line.review_note) ? (
              <span className="text-[oklch(0.45_0.1_70)]">
                <AlertTriangle className="inline size-3" /> {s(line.review_note)}
              </span>
            ) : null}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Eliminar línea">
          <Trash2 className="text-destructive" />
        </Button>
      </div>

      <div className="grid gap-2 rounded-md bg-muted/50 p-2 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid gap-1">
          <ProductPicker
            value={product}
            initialQuery={s(line.original_description).split(/\s+/).slice(0, 2).join(" ")}
            invalid={!s(line.product_id)}
            onSelect={(p) => onPick(p, "manual", null, true)}
            placeholder="Vincular con producto del catálogo…"
          />
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {method ? (
              <Badge variant={confirmed ? "success" : "warning"}>
                {MATCH_METHOD_LABELS[method]}
                {line.match_score !== "" && line.match_score !== null && line.match_score !== undefined ? ` · ${(Number(line.match_score) * 100).toFixed(0)} %` : ""}
              </Badge>
            ) : (
              <Badge variant="warning">No encontrado en el catálogo</Badge>
            )}
            {product && !sameName ? <span className="text-muted-foreground">Catálogo: {product.name}</span> : null}
            {others.length ? <span className="text-muted-foreground">· Otras sugerencias:</span> : null}
            {others.map((c) => (
              <button
                key={c.product_id}
                type="button"
                className="rounded border bg-card px-1.5 py-0.5 hover:bg-accent"
                title={`${MATCH_METHOD_LABELS[c.method]} · coincide con "${c.matched_text}"`}
                onClick={() => onPick({ id: c.product_id, name: c.name, sku: c.sku, purchase_unit: c.purchase_unit, inventory_unit: c.inventory_unit, units_per_package: c.units_per_package }, c.method, c.score, false)}
              >
                {c.name} ({(c.score * 100).toFixed(0)} %)
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s(line.product_id) ? (
            <label className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setValue(`items.${i}.match_confirmed`, v === true, { shouldDirty: true })} />
              Coincidencia confirmada
            </label>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onCreate}>
            <PackagePlus /> Crear producto
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <SmallField label="Código prov.">
          <Input {...register(`items.${i}.supplier_code`)} />
        </SmallField>
        <SmallField label="Cantidad">
          <Input inputMode="decimal" {...register(`items.${i}.quantity`)} aria-invalid={Number(line.quantity) <= 0} />
        </SmallField>
        <SmallField label={`Unidad${s(line.unit_raw) ? ` (${s(line.unit_raw)})` : ""}`}>
          <NativeSelect {...register(`items.${i}.unit`)}>
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code}
              </option>
            ))}
          </NativeSelect>
        </SmallField>
        <SmallField label={product ? `${product.inventory_unit} por unidad` : "Conversión"}>
          <Input inputMode="decimal" {...register(`items.${i}.conversion_factor`)} aria-invalid={factor <= 0} />
        </SmallField>
        <SmallField label="Precio">
          <Input inputMode="decimal" {...register(`items.${i}.unit_price`)} />
        </SmallField>
        <SmallField label="Descuento">
          <Input inputMode="decimal" {...register(`items.${i}.discount`)} />
        </SmallField>
        <SmallField label="Impuesto">
          <Input inputMode="decimal" {...register(`items.${i}.tax`)} />
        </SmallField>
        <SmallField label="Importe línea">
          <Input inputMode="decimal" {...register(`items.${i}.line_total`)} aria-invalid={mismatch} />
        </SmallField>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {s(line.package_description) ? <span>Presentación: {s(line.package_description)}</span> : null}
        {product && factor > 0 ? (
          <span>
            Entrada: {formatNumber(Number(line.quantity) * factor)} {product.inventory_unit} · Costo normalizado:{" "}
            <strong className="text-foreground">
              {formatMoney(Number(line.line_total) / (Number(line.quantity) * factor || 1), currency, 4)} / {product.inventory_unit}
            </strong>
          </span>
        ) : null}
        {mismatch ? (
          <span className="flex items-center gap-1 text-destructive">
            <Calculator className="size-3" /> Cantidad × precio − desc. = {formatMoney(expected, currency)}
            <button type="button" className="underline" onClick={() => setValue(`items.${i}.line_total`, String(expected), { shouldDirty: true })}>
              usar cálculo
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
