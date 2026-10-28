import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { OcrProcessingError, type OcrInput, type OcrOutput, type OcrProvider } from "@/lib/ocr/provider";
import { invoiceExtractionSchema } from "@/lib/ocr/schema";

const SYSTEM = `Eres un sistema experto en lectura de facturas de proveedores para el supermercado EL GIGANTE SUPERMARKET.
Extraes datos de facturas fotografiadas o escaneadas (español o inglés) con precisión contable.

Reglas estrictas:
- Nunca inventes datos. Si un campo no aparece o es ilegible, devuelve null y agrega una advertencia en "warnings".
- Copia la descripción de cada línea exactamente como aparece impresa (sin traducir ni corregir).
- Números: usa punto decimal, sin símbolos de moneda ni separadores de miles. Interpreta correctamente "1.234,50" y "1,234.50" según el contexto del documento.
- Fechas en formato YYYY-MM-DD. Si el orden día/mes es ambiguo (ej. 03/04/2026), usa el formato habitual del país del proveedor y agrega una advertencia.
- line_total es el importe impreso de la línea; no lo recalcules. Si no coincide con cantidad × precio − descuento, agrega una advertencia.
- Incluye todas las líneas de productos, aunque la factura tenga varias páginas. No incluyas como productos las líneas de subtotal, impuestos, fletes o descuentos generales: van en los campos de totales.
- unit_code debe ser uno de los códigos permitidos o null.
- Si la presentación indica empaque (ej. "12/1", "24/15 oz", "12x1L", "CJ 24"), deduce units_per_package (12, 24...). Si no se puede deducir, null.
- Asigna confianza baja (< 0.7) a cualquier valor parcialmente legible, borroso, tachado o escrito a mano.
- Si el documento no es una factura legible, is_invoice = false y explica el motivo en warnings.`;

export class AnthropicOcrProvider implements OcrProvider {
  name = "anthropic";
  model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey, timeout: 110_000, maxRetries: 1 });
    this.model = model || "claude-opus-5-5";
  }

  async extract(input: OcrInput): Promise<OcrOutput> {
    const data = input.bytes.toString("base64");
    const source =
      input.mime === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
        : ({
            type: "image",
            source: { type: "base64", media_type: input.mime as "image/jpeg" | "image/png" | "image/webp", data },
          } as const);

    const units = input.unitCodes.map((u) => `${u.code} (${u.name})`).join(", ");
    const hint = input.supplierHint ? `\nEl usuario indicó que el proveedor probablemente es: "${input.supplierHint}". Verifícalo con el documento.` : "";

    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(invoiceExtractionSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            source,
            {
              type: "text",
              text: `Extrae los datos generales y todas las líneas de productos de esta factura.\nCódigos de unidad permitidos: ${units}.${hint}`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new OcrProcessingError("El servicio de OCR rechazó procesar el documento. Capture los datos manualmente.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new OcrProcessingError("La factura es demasiado extensa para procesarse en una sola lectura. Divida el documento o capture manualmente.");
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new OcrProcessingError("El OCR no devolvió un resultado válido.");
    return { data: parsed, provider: this.name, model: response.model ?? this.model, usage: response.usage };
  }
}
