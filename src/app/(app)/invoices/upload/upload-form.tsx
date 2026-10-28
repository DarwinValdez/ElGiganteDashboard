"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { markUploadComplete, requestInvoiceUpload } from "@/app/(app)/invoices/actions";
import { Field } from "@/components/common/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { formatBytes } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_INVOICE_MIME, MAX_INVOICE_BYTES } from "@/lib/validations";

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function UploadForm({ suppliers, ocrConfigured }: { suppliers: { id: string; trade_name: string }[]; ocrConfigured: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!(ALLOWED_INVOICE_MIME as readonly string[]).includes(f.type)) {
      setError("Formato no admitido. Use JPG, PNG, WEBP o PDF.");
      return;
    }
    if (f.size > MAX_INVOICE_BYTES) {
      setError(`El archivo pesa ${formatBytes(f.size)}; el máximo es 15 MB.`);
      return;
    }
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    try {
      setStep("Calculando huella del archivo…");
      const hash = await sha256Hex(file);
      setStep("Registrando factura…");
      const req = await requestInvoiceUpload({ file_name: file.name, file_mime: file.type as (typeof ALLOWED_INVOICE_MIME)[number], file_size: file.size, file_sha256: hash, supplier_id: supplierId });
      if (!req.ok) throw new Error(req.error);
      const { id, path, token, duplicateOf } = req.data!;
      if (duplicateOf) toast.warning(`Este mismo archivo ya fue subido (factura ${duplicateOf.invoice_number ?? "sin número"}). Revise si es un duplicado.`);
      setStep("Subiendo archivo al almacenamiento privado…");
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from("invoices").uploadToSignedUrl(path, token, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(`Error al subir el archivo: ${upErr.message}`);
      const done = await markUploadComplete(id);
      if (!done.ok) throw new Error(done.error);
      toast.success("Archivo almacenado. Iniciando reconocimiento…");
      router.push(`/invoices/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setStep(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="grid gap-4">
          {!ocrConfigured ? (
            <Alert variant="warning">
              <AlertDescription>
                El OCR no está configurado (falta ANTHROPIC_API_KEY en el servidor). Puede subir la factura igualmente y capturar los datos a mano.
              </AlertDescription>
            </Alert>
          ) : null}
          <Field label="Proveedor (opcional)" hint="Si lo deja vacío, el sistema sugerirá uno a partir de la factura">
            <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Detectar automáticamente</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" variant="outline" className="h-24 flex-col" onClick={() => cameraRef.current?.click()}>
              <Camera className="size-6" /> Tomar fotografía
            </Button>
            <Button type="button" variant="outline" className="h-24 flex-col" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-6" /> Seleccionar archivo
            </Button>
          </div>
          <div
            className="rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
          >
            También puede arrastrar el archivo aquí · JPG, PNG, WEBP o PDF · máx. 15 MB
          </div>
          {file ? (
            <div className="flex items-center justify-between rounded-md bg-muted p-3 text-sm">
              <span className="truncate">
                {file.name} · {formatBytes(file.size)}
              </span>
              <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="Quitar archivo" disabled={!!step}>
                <X />
              </Button>
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button onClick={upload} disabled={!file || !!step} size="lg">
            {step ? <Loader2 className="animate-spin" /> : <FileUp />}
            {step ?? "Subir y procesar factura"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Vista previa de la factura" className="max-h-[70vh] rounded-md object-contain" />
          ) : file ? (
            <p className="text-sm text-muted-foreground">Documento PDF listo para subir.</p>
          ) : (
            <p className="text-sm text-muted-foreground">La vista previa aparecerá aquí.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
