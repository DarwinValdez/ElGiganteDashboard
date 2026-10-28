import "server-only";

import type { InvoiceExtraction } from "@/lib/ocr/schema";

export interface OcrInput {
  bytes: Buffer;
  mime: string;
  unitCodes: { code: string; name: string }[];
  supplierHint?: string | null;
}

export interface OcrOutput {
  data: InvoiceExtraction;
  provider: string;
  model: string;
  usage?: unknown;
}

export interface OcrProvider {
  name: string;
  model: string;
  extract(input: OcrInput): Promise<OcrOutput>;
}

export class OcrNotConfiguredError extends Error {
  constructor() {
    super(
      "El proveedor de OCR no está configurado. Defina ANTHROPIC_API_KEY en las variables de entorno del servidor (ver README) o capture la factura manualmente.",
    );
  }
}

export class OcrProcessingError extends Error {}
