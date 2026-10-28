"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, ScanText } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export async function runOcr(invoiceId: string, force = false): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/invoices/${invoiceId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? { ok: true } : { ok: false, error: json.error ?? `Error ${res.status}` };
}

/** Lanza el OCR al abrir una factura recién subida y refresca mientras se procesa. */
export function ProcessingPanel({ invoiceId, status, autoStart }: { invoiceId: string; status: "uploaded" | "processing"; autoStart: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [running, setRunning] = useState(status === "processing");

  const start = async () => {
    setRunning(true);
    const r = await runOcr(invoiceId);
    if (r.ok) toast.success("Factura reconocida. Revise los datos antes de confirmar.");
    else toast.error(r.error);
    setRunning(false);
    router.refresh();
  };

  useEffect(() => {
    if (autoStart && status === "uploaded" && !started.current) {
      started.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "processing") return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [status, router]);

  return (
    <Alert>
      {running ? <Loader2 className="animate-spin" /> : <ScanText />}
      <AlertTitle>{running ? "Reconociendo la factura…" : "Factura pendiente de procesar"}</AlertTitle>
      <AlertDescription>
        {running ? (
          <p>La lectura con OCR e IA puede tardar hasta un minuto. Puede seguir trabajando en otras pantallas.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p>El archivo está almacenado.</p>
            <Button size="sm" onClick={start}>
              <RefreshCw /> Procesar ahora
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
