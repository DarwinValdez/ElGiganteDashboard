import "server-only";

import { AnthropicOcrProvider } from "@/lib/ocr/anthropic";
import { OcrNotConfiguredError, type OcrProvider } from "@/lib/ocr/provider";

/** Devuelve el proveedor de OCR configurado o lanza OcrNotConfiguredError. */
export function getOcrProvider(): OcrProvider {
  const provider = (process.env.OCR_PROVIDER ?? "anthropic").toLowerCase();
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new OcrNotConfiguredError();
    return new AnthropicOcrProvider(key, process.env.OCR_MODEL);
  }
  throw new OcrNotConfiguredError();
}

export function isOcrConfigured(): boolean {
  return (process.env.OCR_PROVIDER ?? "anthropic").toLowerCase() === "anthropic" && !!process.env.ANTHROPIC_API_KEY;
}
