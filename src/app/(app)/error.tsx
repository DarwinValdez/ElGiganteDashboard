"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-12 max-w-lg rounded-lg border bg-card p-6 text-center">
      <AlertTriangle className="mx-auto mb-3 size-8 text-destructive" />
      <h2 className="text-lg font-semibold">No se pudo cargar esta pantalla</h2>
      <p className="mt-2 text-sm text-muted-foreground">{error.message || "Error inesperado."}</p>
      {error.digest ? <p className="mt-1 text-xs text-muted-foreground">Ref: {error.digest}</p> : null}
      <Button className="mt-4" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
