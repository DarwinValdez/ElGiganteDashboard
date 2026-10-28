"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { recordMovement } from "@/app/(app)/inventory/actions";
import type { ProductOption } from "@/app/(app)/products/search-action";
import { Field } from "@/components/common/field";
import { ProductPicker } from "@/components/common/product-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatNumber } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/labels";
import type { MovementType } from "@/lib/types";

const BASIC: MovementType[] = ["sale", "issue", "damage", "loss"];
const ADVANCED: MovementType[] = ["adjustment_in", "adjustment_out", "return_supplier"];

export function MovementDialog({ canAdjust }: { canAdjust: boolean }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [type, setType] = useState<MovementType>("sale");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const types = canAdjust ? [...BASIC, ...ADVANCED] : BASIC;
  const needsReason = !["sale", "issue"].includes(type);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowLeftRight /> Registrar movimiento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Movimiento de inventario</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Producto" required>
            <ProductPicker value={product} onSelect={setProduct} />
            {product ? (
              <p className="text-xs text-muted-foreground">
                Existencias: {formatNumber(product.current_stock)} {product.inventory_unit}
              </p>
            ) : null}
          </Field>
          <Field label="Tipo" required>
            <NativeSelect value={type} onChange={(e) => setType(e.target.value as MovementType)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={`Cantidad${product ? ` (${product.inventory_unit})` : ""}`} required hint="Siempre positiva; el sistema aplica el signo según el tipo">
            <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Motivo" required={needsReason}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needsReason ? "Obligatorio para ajustes, daños y pérdidas" : "Opcional"} />
          </Field>
          <Button
            disabled={pending || !product || !quantity || (needsReason && reason.trim().length < 3)}
            onClick={() =>
              start(async () => {
                const res = await recordMovement({ product_id: product!.id, movement_type: type as never, quantity, reason });
                if (!res.ok) return void toast.error(res.error);
                toast.success(res.message);
                setOpen(false);
                setProduct(null);
                setQuantity("");
                setReason("");
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Registrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
