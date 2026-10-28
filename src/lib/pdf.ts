"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface PdfTableDoc {
  filename: string;
  title: string;
  subtitle?: string;
  meta?: [string, string][];
  head: string[];
  body: (string | number)[][];
  foot?: (string | number)[][];
  notes?: string;
  landscape?: boolean;
}

const GREEN: [number, number, number] = [22, 83, 45];

/** Genera y descarga un PDF con encabezado de la empresa y una tabla. */
export function downloadTablePdf(d: PdfTableDoc) {
  const doc = new jsPDF({ orientation: d.landscape ? "landscape" : "portrait", unit: "pt", format: "letter" });
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, width, 56, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("EL GIGANTE SUPERMARKET", 40, 34);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleString("es"), width - 40, 34, { align: "right" });

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(d.title, 40, 84);
  let y = 100;
  if (d.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(d.subtitle, 40, y);
    y += 14;
  }
  doc.setFontSize(9);
  for (const [k, v] of d.meta ?? []) {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, 40, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, 140, y);
    y += 12;
  }

  autoTable(doc, {
    startY: y + 8,
    head: [d.head],
    body: d.body,
    foot: d.foot,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: GREEN, textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    margin: { left: 40, right: 40 },
  });

  if (d.notes) {
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(`Notas: ${d.notes}`, width - 80), 40, finalY + 20);
  }
  doc.save(d.filename);
}
