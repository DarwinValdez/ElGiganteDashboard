import "server-only";
import { createHash } from "node:crypto";

/** Detecta el tipo real del archivo por su firma (no confía en la extensión ni en el Content-Type). */
export function detectMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Reduce imágenes grandes antes de enviarlas al OCR (límite de tamaño de la API).
 * El archivo original se conserva intacto en el almacenamiento.
 */
export async function prepareImageForOcr(buf: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string }> {
  if (mime === "application/pdf") return { bytes: buf, mime };
  const sharp = (await import("sharp")).default;
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (buf.length <= 3_500_000 && longSide <= 3000) return { bytes: buf, mime };
  const out = await img
    .resize({ width: 2600, height: 2600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { bytes: out, mime: "image/jpeg" };
}
