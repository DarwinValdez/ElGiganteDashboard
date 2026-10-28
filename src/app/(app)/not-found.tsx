import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto mt-12 max-w-lg rounded-lg border bg-card p-6 text-center">
      <h2 className="text-lg font-semibold">Registro no encontrado</h2>
      <p className="mt-2 text-sm text-muted-foreground">No existe o no tiene permiso para verlo.</p>
      <Button asChild className="mt-4">
        <Link href="/">Volver al panel</Link>
      </Button>
    </div>
  );
}
