/**
 * reportGenerator.ts
 *
 * Generates PDF and Excel reports from pre-fetched data.
 * Uses pdfkit for PDF and exceljs for Excel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

// ── Colours / Branding ──────────────────────────────────────────────────────
const BRAND_COLOR  = "#1e293b"; // slate-800
const ACCENT_COLOR = "#6d28d9"; // violet-700
const HEADER_BG    = "#0f172a"; // slate-900
const TEXT_MUTED   = "#64748b"; // slate-500
const BORDER_COLOR = "#e2e8f0"; // slate-200
const ROW_ALT      = "#f8fafc"; // slate-50

// ── Types ───────────────────────────────────────────────────────────────────
export interface ReportMeta {
  reportType: string;
  reportTitle: string;
  projectName: string;
  projectCode?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  generatedAt: string;
  generatedBy: string;
  generatedByRole: string;
}

export interface ReportData {
  sections: ReportSection[];
  summary?: Record<string, string | number | null>;
}

export interface ReportSection {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number | null)[][];
  totals?: (string | number | null)[];
}

// ── PDF Generator ────────────────────────────────────────────────────────────

export function generatePDF(meta: ReportMeta, data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const margin = 40;
      const contentW = pageW - margin * 2;

      let currentPage = 1;

      // ── Page header helper ──────────────────────────────────────────────
      const drawPageHeader = () => {
        // Top bar
        doc.rect(0, 0, pageW, 50).fill(HEADER_BG);
        doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold")
          .text("HEVEA PARTNERS", margin, 14);
        doc.fillColor("#a5b4fc").fontSize(9).font("Helvetica")
          .text(meta.reportTitle, margin, 32);
        // Right side info
        const rightX = pageW - 240;
        doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
          .text(`Project: ${meta.projectName}`, rightX, 14, { width: 200, align: "right" })
          .text(`Generated: ${meta.generatedAt}`, rightX, 26, { width: 200, align: "right" })
          .text(`By: ${meta.generatedBy} (${meta.generatedByRole})`, rightX, 38, { width: 200, align: "right" });

        if (meta.dateStart || meta.dateEnd) {
          const dr = [meta.dateStart, meta.dateEnd].filter(Boolean).join(" – ");
          doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica")
            .text(`Period: ${dr}`, margin, 38);
        }
      };

      // ── Page footer helper ──────────────────────────────────────────────
      const drawPageFooter = () => {
        const y = pageH - 28;
        doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(BORDER_COLOR).lineWidth(0.5).stroke();
        doc.fillColor(TEXT_MUTED).fontSize(7).font("Helvetica")
          .text(`Page ${currentPage}  ·  Hevea Partners ERP  ·  CONFIDENTIAL`, margin, y + 6, { width: contentW, align: "center" });
      };

      // ── Summary section ─────────────────────────────────────────────────
      const drawSummary = (y: number): number => {
        if (!data.summary || Object.keys(data.summary).length === 0) return y;

        const entries = Object.entries(data.summary);
        const colW = Math.min(160, contentW / Math.min(4, entries.length));
        const boxH = 52;

        let x = margin;
        let row = 0;
        entries.forEach(([k, v], i) => {
          if (i > 0 && i % 4 === 0) { row++; x = margin; y += boxH + 6; }

          const xPos = margin + (i % 4) * (colW + 8);
          doc.rect(xPos, y, colW, boxH).fillColor("#f1f5f9").fill();
          doc.rect(xPos, y, 3, boxH).fillColor(ACCENT_COLOR).fill();

          doc.fillColor(TEXT_MUTED).fontSize(7).font("Helvetica")
            .text(String(k).toUpperCase(), xPos + 8, y + 8, { width: colW - 10 });
          doc.fillColor(BRAND_COLOR).fontSize(13).font("Helvetica-Bold")
            .text(String(v ?? "—"), xPos + 8, y + 20, { width: colW - 10 });
          x += colW + 8;
        });
        return y + boxH + 14;
      };

      // ── Table helper ────────────────────────────────────────────────────
      const drawTable = (section: ReportSection, startY: number): number => {
        const { columns, rows, totals } = section;
        const colW = Math.floor(contentW / columns.length);
        const rowH = 18;
        const headerH = 22;
        let y = startY;

        // Table header
        doc.rect(margin, y, contentW, headerH).fillColor(BRAND_COLOR).fill();
        columns.forEach((col, i) => {
          doc.fillColor("#ffffff").fontSize(7.5).font("Helvetica-Bold")
            .text(col, margin + i * colW + 4, y + 6, { width: colW - 8, ellipsis: true });
        });
        y += headerH;

        // Rows
        rows.forEach((row, ri) => {
          const rowBg = ri % 2 === 0 ? "#ffffff" : ROW_ALT;
          doc.rect(margin, y, contentW, rowH).fillColor(rowBg).fill();
          doc.moveTo(margin, y + rowH).lineTo(margin + contentW, y + rowH)
            .strokeColor("#e2e8f0").lineWidth(0.3).stroke();

          row.forEach((cell, ci) => {
            doc.fillColor(BRAND_COLOR).fontSize(7.5).font("Helvetica")
              .text(String(cell ?? "—"), margin + ci * colW + 4, y + 4, { width: colW - 8, ellipsis: true });
          });

          y += rowH;

          // Page break
          if (y > pageH - 60) {
            drawPageFooter();
            doc.addPage();
            currentPage++;
            drawPageHeader();
            y = 62;
            // Redraw column headers
            doc.rect(margin, y, contentW, headerH).fillColor(BRAND_COLOR).fill();
            columns.forEach((col, i) => {
              doc.fillColor("#ffffff").fontSize(7.5).font("Helvetica-Bold")
                .text(col, margin + i * colW + 4, y + 6, { width: colW - 8, ellipsis: true });
            });
            y += headerH;
          }
        });

        // Totals row
        if (totals) {
          doc.rect(margin, y, contentW, rowH).fillColor("#e0e7ff").fill();
          totals.forEach((cell, ci) => {
            doc.fillColor(ACCENT_COLOR).fontSize(7.5).font("Helvetica-Bold")
              .text(String(cell ?? ""), margin + ci * colW + 4, y + 4, { width: colW - 8, ellipsis: true });
          });
          y += rowH;
        }

        return y + 12;
      };

      // ── Build first page ────────────────────────────────────────────────
      drawPageHeader();
      let y = 62;

      // Report title block
      doc.rect(margin, y, contentW, 36).fillColor("#f8fafc").fill();
      doc.rect(margin, y, 4, 36).fillColor(ACCENT_COLOR).fill();
      doc.fillColor(BRAND_COLOR).fontSize(16).font("Helvetica-Bold")
        .text(meta.reportTitle, margin + 12, y + 6);
      doc.fillColor(TEXT_MUTED).fontSize(9).font("Helvetica")
        .text(`${meta.reportType.toUpperCase()} REPORT  ·  ${meta.projectName}`, margin + 12, y + 24);
      y += 46;

      // Summary KPIs
      y = drawSummary(y);

      // Sections
      data.sections.forEach((section) => {
        // Check page space for section header
        if (y > pageH - 100) {
          drawPageFooter();
          doc.addPage();
          currentPage++;
          drawPageHeader();
          y = 62;
        }

        // Section heading
        doc.rect(margin, y, contentW, 22).fillColor("#ede9fe").fill();
        doc.fillColor(ACCENT_COLOR).fontSize(10).font("Helvetica-Bold")
          .text(section.title, margin + 8, y + 5);
        if (section.subtitle) {
          doc.fillColor(TEXT_MUTED).fontSize(8).font("Helvetica")
            .text(section.subtitle, margin + 8, y + 14);
        }
        y += 28;

        if (section.rows.length === 0) {
          doc.fillColor(TEXT_MUTED).fontSize(8).font("Helvetica")
            .text("No data available for this section.", margin + 8, y);
          y += 18;
        } else {
          y = drawTable(section, y);
        }
      });

      drawPageFooter();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Excel Generator ──────────────────────────────────────────────────────────

export async function generateExcel(meta: ReportMeta, data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hevea Partners ERP";
  wb.created = new Date();
  wb.modified = new Date();

  // ── Cover sheet ─────────────────────────────────────────────────────────
  const cover = wb.addWorksheet("Cover");
  cover.columns = [{ width: 30 }, { width: 50 }];
  cover.addRow(["HEVEA PARTNERS ERP"]).font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  cover.addRow([]);
  cover.addRow(["Report Type:", meta.reportTitle]);
  cover.addRow(["Project:", meta.projectName]);
  if (meta.projectCode) cover.addRow(["Project Code:", meta.projectCode]);
  if (meta.dateStart || meta.dateEnd) {
    cover.addRow(["Period:", [meta.dateStart, meta.dateEnd].filter(Boolean).join(" to ")]);
  }
  cover.addRow(["Generated At:", meta.generatedAt]);
  cover.addRow(["Generated By:", `${meta.generatedBy} (${meta.generatedByRole})`]);
  cover.addRow([]);
  cover.addRow(["CONFIDENTIAL — For authorised recipients only"]).font = {
    italic: true, color: { argb: "FF6D28D9" },
  };

  // Style label column
  [3, 4, 5, 6, 7, 8].forEach((r) => {
    const cell = cover.getCell(r, 1);
    cell.font = { bold: true, color: { argb: "FF475569" } };
  });

  // ── Summary sheet ─────────────────────────────────────────────────────
  if (data.summary && Object.keys(data.summary).length > 0) {
    const summarySheet = wb.addWorksheet("Summary");
    summarySheet.columns = [{ width: 36 }, { width: 24 }];
    const headerRow = summarySheet.addRow(["Metric", "Value"]);
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
    headerRow.height = 22;

    Object.entries(data.summary).forEach(([k, v], i) => {
      const row = summarySheet.addRow([k, v ?? "—"]);
      row.height = 18;
      if (i % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        });
      }
    });
  }

  // ── Data sections ─────────────────────────────────────────────────────
  data.sections.forEach((section) => {
    const sheetName = section.title.substring(0, 31).replace(/[:\\/\[\]\*\?]/g, "_");
    const ws = wb.addWorksheet(sheetName);

    ws.columns = section.columns.map((col) => ({
      header: col,
      width: Math.max(14, Math.min(40, col.length + 4)),
    }));

    // Style header row
    const hRow = ws.getRow(1);
    hRow.height = 22;
    hRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9.5 };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF6D28D9" } },
      };
    });

    // Data rows
    section.rows.forEach((row, ri) => {
      const wsRow = ws.addRow(row.map((v) => v ?? ""));
      wsRow.height = 16;
      if (ri % 2 === 0) {
        wsRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        });
      }
      wsRow.eachCell((cell) => {
        cell.font = { size: 9 };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      });
    });

    // Totals row
    if (section.totals) {
      const totRow = ws.addRow(section.totals.map((v) => v ?? ""));
      totRow.height = 18;
      totRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
        cell.font = { bold: true, color: { argb: "FF6D28D9" }, size: 9.5 };
      });
    }

    // Freeze header row
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Auto-filter
    if (section.rows.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: section.columns.length } };
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
