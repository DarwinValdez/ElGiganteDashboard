"use client";

import { useState } from "react";
import { Download, ExternalLink, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DocumentViewer({ invoiceId, mime, fileName }: { invoiceId: string; mime: string | null; fileName: string | null }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const src = `/api/invoices/${invoiceId}/file`;
  const isPdf = mime === "application/pdf";
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="mr-auto truncate text-xs text-muted-foreground">{fileName ?? "Documento original"}</span>
        {!isPdf ? (
          <>
            <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Alejar">
              <ZoomOut />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Acercar">
              <ZoomIn />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotar">
              <RotateCw />
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="icon" asChild>
          <a href={src} target="_blank" rel="noreferrer" aria-label="Abrir en otra pestaña">
            <ExternalLink />
          </a>
        </Button>
        <Button variant="ghost" size="icon" asChild>
          <a href={`${src}?download=1`} aria-label="Descargar">
            <Download />
          </a>
        </Button>
      </div>
      <div className="min-h-[50vh] flex-1 overflow-auto bg-muted/50 lg:min-h-0">
        {isPdf ? (
          <iframe src={src} title="Factura PDF" className="h-[75vh] w-full" />
        ) : (
          <div className="flex justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Factura original"
              style={{ width: `${zoom * 100}%`, transform: `rotate(${rotation}deg)`, transformOrigin: "center" }}
              className="max-w-none transition-transform"
            />
          </div>
        )}
      </div>
    </div>
  );
}
