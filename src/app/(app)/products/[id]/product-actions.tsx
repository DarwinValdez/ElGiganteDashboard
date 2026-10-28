"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteAlias, deleteSupplierCode, setProductActive } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";

export function ToggleActiveButton({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setProductActive(id, !active);
          if (res.ok) {
            toast.success(res.message);
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      {active ? "Desactivar" : "Activar"}
    </Button>
  );
}

export function DeleteLinkButton({ kind, id, productId }: { kind: "code" | "alias"; id: string; productId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-label="Eliminar asociación"
      onClick={() => {
        if (!window.confirm("¿Eliminar esta asociación? Las facturas ya confirmadas no cambian.")) return;
        start(async () => {
          const res = kind === "code" ? await deleteSupplierCode(id, productId) : await deleteAlias(id, productId);
          if (res.ok) {
            toast.success(res.message);
            router.refresh();
          } else toast.error(res.error);
        });
      }}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}
