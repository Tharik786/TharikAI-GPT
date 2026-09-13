import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";

/**
 * Standard trigger to download blob in browser
 */
export function triggerDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/**
 * Download raw text or code file (e.g. script.py, index.html, styles.css)
 */
export function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  triggerDownload(blob, filename);
}

/**
 * Clean document text: strip web citation URLs, raw brackets, and template metadata
 */
export function cleanDocumentText(text) {
  if (!text) return "";
  return text
    // Remove markdown image tags ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, "")
    // Remove web search citation links: [1](https://...), [2](https://...)
    .replace(/\[\d+\]\([^)]+\)/g, "")
    // Remove citation numbers in brackets: [1], [2], [12]
    .replace(/\[\d+\]/g, "")
    // Remove markdown links but preserve the readable anchor text: [Anchor](url) -> Anchor
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove standalone URLs
    .replace(/https?:\/\/[^\s)]+/g, "")
    // Remove template metadata lines
    .replace(/^(?:Executive\s+)?Document:\s*.*$/gim, "")
    .replace(/^Date:\s*.*$/gim, "")
    .replace(/^Prepared\s+by:\s*.*$/gim, "")
    .replace(/^Author:\s*.*$/gim, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .trim();
}

/**
 * Clean markdown symbols for clean document text export
 */
export function cleanMarkdownForDoc(text) {
  if (!text) return "";
  return cleanDocumentText(text)
    .replace(/^#+\s+/gm, "") // remove heading hashes
    .replace(/\*\*(.+?)\*\*/g, "$1") // remove bold
    .replace(/\*(.+?)\*/g, "$1") // remove italics
    .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`{3}\w*\n?/g, "")) // clean code fences
    .replace(/`(.+?)`/g, "$1") // remove inline code ticks
    .trim();
}

/**
 * Export message or content as a PDF Document
 */
export function exportToPdf(title, content, filename = "TharikAI_Document.pdf") {
  try {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const maxLineWidth = pageWidth - margin * 2;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text(title || "Document", margin, margin + 6);

    // Title underline
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.6);
    doc.line(margin, margin + 10, margin + 50, margin + 10);

    // Content Body
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(51, 65, 85);

    const cleanContent = cleanMarkdownForDoc(content);
    const lines = doc.splitTextToSize(cleanContent, maxLineWidth);

    let cursorY = margin + 18;
    const lineHeight = 6;

    for (let i = 0; i < lines.length; i++) {
      if (cursorY + lineHeight > pageHeight - margin) {
        doc.addPage();
        cursorY = margin + 5;
      }
      doc.text(lines[i], margin, cursorY);
      cursorY += lineHeight;
    }

    // Clean page numbers
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${i} of ${totalPages}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: "right" }
      );
    }

    doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    return true;
  } catch (err) {
    console.error("PDF Export Error:", err);
    throw err;
  }
}

/**
 * Export tabular data or Markdown Table into Excel (.xlsx) / CSV
 */
export function exportTableToExcel(tableDataOrMarkdown, filename = "TharikAI_Data.xlsx") {
  try {
    let rows = [];

    if (Array.isArray(tableDataOrMarkdown)) {
      rows = tableDataOrMarkdown;
    } else if (typeof tableDataOrMarkdown === "string") {
      // Parse markdown table format: | Col 1 | Col 2 |
      const rawLines = tableDataOrMarkdown.trim().split("\n");
      for (const line of rawLines) {
        if (!line.includes("|")) continue;
        if (line.match(/^\|?\s*[-:]+[-| :]*\|?$/)) continue; // skip divider line
        const cols = line
          .split("|")
          .map((c) => cleanDocumentText(c.trim()))
          .filter((_, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length <= 2);
        if (cols.length > 0) {
          rows.push(cols);
        }
      }
    }

    if (rows.length === 0) {
      // If not a formal table, split content into rows
      const textLines = (tableDataOrMarkdown || "").split("\n").filter((l) => l.trim());
      rows = textLines.map((l) => [cleanDocumentText(l)]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto-fit column widths so cell text is not truncated or hidden
    if (rows.length > 0 && rows[0].length > 0) {
      const colWidths = rows[0].map((_, colIdx) => {
        let maxLen = 14;
        rows.forEach((r) => {
          const val = r[colIdx] != null ? String(r[colIdx]) : "";
          if (val.length > maxLen) {
            maxLen = Math.min(val.length + 3, 50);
          }
        });
        return { wch: maxLen };
      });
      ws["!cols"] = colWidths;
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    const finalName = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
    XLSX.writeFile(wb, finalName);
    return true;
  } catch (err) {
    console.error("Excel Export Error:", err);
    throw err;
  }
}

/**
 * Format markdown into styled HTML for Word document export
 */
function markdownToWordHtml(title, content) {
  const cleanTitle = cleanDocumentText(title) || "Document";
  const cleanedContent = cleanDocumentText(content);
  let body = cleanedContent
    // Convert markdown tables
    .replace(/(\|.+\|\r?\n)((?:\|[-: ]+\|\r?\n)+)((?:\|.+\|\r?\n?)+)/g, (match, header, div, rows) => {
      const ths = header.split("|").filter((c) => c.trim()).map((c) => `<th style="background:#0f172a;color:#ffffff;padding:8px 12px;border:1px solid #334155;text-align:left;">${c.trim()}</th>`).join("");
      const trs = rows.trim().split("\n").map((r) => {
        const tds = r.split("|").filter((c) => c.trim()).map((c) => `<td style="padding:8px 12px;border:1px solid #cbd5e1;">${c.trim()}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:10pt;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    })
    // Headings
    .replace(/^#\s+(.+)$/gm, '<h1 style="color:#0f172a;font-size:18pt;border-bottom:2px solid #10b981;padding-bottom:6px;margin-top:20px;">$1</h1>')
    .replace(/^##\s+(.+)$/gm, '<h2 style="color:#1e293b;font-size:14pt;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-top:16px;">$1</h2>')
    .replace(/^###\s+(.+)$/gm, '<h3 style="color:#334155;font-size:12pt;margin-top:12px;">$1</h3>')
    // Bold and Italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Lists
    .replace(/^[-*•]\s+(.+)$/gm, '<li style="margin-bottom:4px;">$1</li>')
    // Code blocks
    .replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '<pre style="background:#f1f5f9;color:#0f172a;padding:12px;border-radius:6px;font-family:Consolas,monospace;font-size:9.5pt;border:1px solid #e2e8f0;">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;color:#0f172a;padding:2px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:9.5pt;">$1</code>')
    // Paragraphs
    .replace(/\n\n/g, "</p><p style='margin-bottom:10px;'>")
    .replace(/\n/g, "<br/>");

  return `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${cleanTitle}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1e293b; padding: 28px; }
        h1 { color: #0f172a; font-size: 20pt; border-bottom: 2.5px solid #10b981; padding-bottom: 8px; margin-bottom: 16px; }
        h2 { color: #1e293b; font-size: 14pt; margin-top: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        h3 { color: #334155; font-size: 12pt; margin-top: 14px; }
        p { margin-bottom: 12px; }
        ul { margin: 0 0 12px 20px; padding: 0; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10pt; }
        th { background: #0f172a; color: #ffffff; padding: 8px 10px; text-align: left; }
        td { border: 1px solid #cbd5e1; padding: 8px 10px; }
      </style>
    </head>
    <body>
      <h1>${cleanTitle}</h1>
      <p>${body}</p>
    </body>
    </html>
  `;
}

/**
 * Export content to formatted Microsoft Word (.docx / .doc)
 */
export function exportToWordDoc(title, content, filename = "Document.docx") {
  try {
    const htmlContent = markdownToWordHtml(title, content);
    const blob = new Blob(["\ufeff" + htmlContent], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8",
    });
    const finalName = filename.endsWith(".docx") ? filename : (filename.endsWith(".doc") ? filename : `${filename}.docx`);
    triggerDownload(blob, finalName);
    return true;
  } catch (err) {
    console.error("Word Export Error:", err);
    throw err;
  }
}

/**
 * Export all formats (Word .docx, Excel .xlsx, PPT .pptx, PDF .pdf) packaged into a single ZIP
 */
export async function exportAllInOneZip(title, content, filename = "Documents_All_Formats.zip") {
  try {
    const zip = new JSZip();
    const cleanTitle = cleanDocumentText(title) || "Document";
    const base = cleanTitle.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "Document";

    // 1. Word (.docx)
    try {
      const htmlContent = markdownToWordHtml(title, content);
      zip.file(`${base}.docx`, "\ufeff" + htmlContent);
    } catch (e) {
      console.warn("Word in zip error:", e);
    }

    // 2. Excel (.xlsx)
    try {
      let rows = [];
      const rawLines = (content || "").trim().split("\n");
      for (const line of rawLines) {
        if (!line.includes("|")) continue;
        if (line.match(/^\|?\s*[-:]+[-| :]*\|?$/)) continue;
        const cols = line
          .split("|")
          .map((c) => cleanDocumentText(c.trim()))
          .filter((_, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length <= 2);
        if (cols.length > 0) rows.push(cols);
      }
      if (rows.length === 0) {
        rows = (content || "").split("\n").filter((l) => l.trim()).map((l) => [cleanDocumentText(l)]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      if (rows.length > 0 && rows[0].length > 0) {
        ws["!cols"] = rows[0].map((_, colIdx) => {
          let maxLen = 14;
          rows.forEach((r) => {
            const val = r[colIdx] != null ? String(r[colIdx]) : "";
            if (val.length > maxLen) maxLen = Math.min(val.length + 3, 50);
          });
          return { wch: maxLen };
        });
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const excelBlob = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      zip.file(`${base}.xlsx`, excelBlob);
    } catch (e) {
      console.warn("Excel in zip error:", e);
    }

    // 3. PowerPoint (.pptx) - Fixed 16:9 Widescreen dimensions (10.0 x 5.625)
    try {
      const pptx = new pptxgen();
      pptx.layout = "LAYOUT_16x9";
      pptx.title = cleanTitle;

      // Title Slide
      const titleSlide = pptx.addSlide();
      titleSlide.background = { color: "0F172A" };
      titleSlide.addShape(pptx.ShapeType.rect, {
        x: 0.8, y: 1.8, w: 0.08, h: 1.8, fill: { color: "F97316" }
      });
      titleSlide.addText(cleanTitle, {
        x: 1.1, y: 1.8, w: 8.0, h: 1.2, fontSize: 28, bold: true, color: "FFFFFF", valign: "middle", wrap: true
      });
      titleSlide.addText("Executive Presentation • Generated by TharikAI", {
        x: 1.1, y: 3.1, w: 8.0, h: 0.5, fontSize: 13, color: "94A3B8"
      });

      const rawClean = cleanDocumentText(content);
      const lines = rawClean.split("\n");
      let curTitle = "";
      let curBullets = [];
      const slides = [];

      for (const rawL of lines) {
        const l = rawL.trim();
        if (!l) continue;
        if (l.startsWith("# ") || l.startsWith("## ") || l.startsWith("### ") || l.match(/^Slide\s+\d+:/i)) {
          if (curTitle || curBullets.length > 0) {
            slides.push({ title: curTitle || "Overview", bullets: [...curBullets] });
            curBullets = [];
          }
          curTitle = l.replace(/^#+\s*/, "").replace(/^Slide\s+\d+:\s*/i, "").replace(/\*\*/g, "").trim();
        } else {
          const b = l.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").trim();
          if (b.length > 0) curBullets.push(b);
        }
      }
      if (curTitle || curBullets.length > 0) {
        slides.push({ title: curTitle || "Summary", bullets: [...curBullets] });
      }
      if (slides.length === 0) {
        slides.push({ title: "Key Highlights", bullets: lines.slice(0, 5).map((x) => cleanDocumentText(x.trim())).filter(Boolean) });
      }

      // Chunk into max 5 bullets per slide so text never overflows slide
      const finalSlides = [];
      slides.forEach((sd) => {
        const maxPerSlide = 5;
        if (sd.bullets.length <= maxPerSlide) {
          finalSlides.push(sd);
        } else {
          for (let i = 0; i < sd.bullets.length; i += maxPerSlide) {
            const chunk = sd.bullets.slice(i, i + maxPerSlide);
            const part = i === 0 ? "" : ` (Cont. ${Math.floor(i / maxPerSlide) + 1})`;
            finalSlides.push({ title: `${sd.title}${part}`, bullets: chunk });
          }
        }
      });

      finalSlides.forEach((sd, sIdx) => {
        const slide = pptx.addSlide();
        slide.background = { color: "F8FAFC" };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.9, fill: { color: "0F172A" } });
        slide.addText(sd.title, {
          x: 0.6, y: 0.15, w: 8.8, h: 0.6, fontSize: 18, bold: true, color: "FFFFFF", valign: "middle", wrap: true
        });

        // Content card
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.6, y: 1.15, w: 8.8, h: 3.85, fill: { color: "FFFFFF" }, line: { color: "E2E8F0", width: 1 }
        });

        const items = sd.bullets.map((b) => ({
          text: b,
          options: { fontSize: 12, color: "1E293B", bullet: { type: "bullet", code: "2022" }, breakLine: true, spacing: { after: 10 } }
        }));
        if (items.length > 0) {
          slide.addText(items, {
            x: 0.85, y: 1.35, w: 8.3, h: 3.45, margin: 0, valign: "top", wrap: true
          });
        }

        // Footer
        slide.addText(cleanTitle, { x: 0.6, y: 5.15, w: 5.0, h: 0.35, fontSize: 9, color: "94A3B8" });
        slide.addText(`Slide ${sIdx + 2} of ${finalSlides.length + 1}`, {
          x: 5.6, y: 5.15, w: 3.8, h: 0.35, fontSize: 9, color: "94A3B8", align: "right"
        });
      });

      const pptxBlob = await pptx.write({ outputType: "blob" });
      zip.file(`${base}.pptx`, pptxBlob);
    } catch (e) {
      console.warn("PPT in zip error:", e);
    }

    // 4. PDF (.pdf)
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 18;
      const maxLineWidth = pageWidth - margin * 2;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42);
      doc.text(cleanTitle, margin, margin + 6);
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(0.6);
      doc.line(margin, margin + 10, margin + 50, margin + 10);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(51, 65, 85);
      const splitLines = doc.splitTextToSize(cleanMarkdownForDoc(content), maxLineWidth);
      let curY = margin + 18;
      for (const line of splitLines) {
        if (curY + 6 > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          curY = margin + 5;
        }
        doc.text(line, margin, curY);
        curY += 6;
      }
      const pdfBlob = doc.output("blob");
      zip.file(`${base}.pdf`, pdfBlob);
    } catch (e) {
      console.warn("PDF in zip error:", e);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const finalName = filename.endsWith(".zip") ? filename : `${filename}.zip`;
    triggerDownload(blob, finalName);
    return true;
  } catch (err) {
    console.error("ZIP All Error:", err);
    throw err;
  }
}

/**
 * Export files or multi-file code into a single .ZIP archive
 */
export async function exportToZip(files, zipFilename = "Project_Archive.zip") {
  try {
    const zip = new JSZip();

    files.forEach((file) => {
      zip.file(file.name, file.content);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const finalName = zipFilename.endsWith(".zip") ? zipFilename : `${zipFilename}.zip`;
    triggerDownload(blob, finalName);
    return true;
  } catch (err) {
    console.error("ZIP Export Error:", err);
    throw err;
  }
}

/**
 * Extract all code blocks from markdown content
 * Returns array of { language, name, content }
 */
export function extractCodeBlocksFromMarkdown(markdownText) {
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  let index = 1;

  const extMap = {
    python: "py",
    py: "py",
    javascript: "js",
    js: "js",
    jsx: "jsx",
    typescript: "ts",
    ts: "ts",
    tsx: "tsx",
    html: "html",
    css: "css",
    json: "json",
    sql: "sql",
    cpp: "cpp",
    c: "c",
    java: "java",
    go: "go",
    rust: "rs",
    rs: "rs",
    php: "php",
    ruby: "rb",
    sh: "sh",
    bash: "sh",
    markdown: "md",
    md: "md",
  };

  while ((match = codeBlockRegex.exec(markdownText)) !== null) {
    const lang = (match[1] || "txt").toLowerCase();
    const code = match[2];
    const ext = extMap[lang] || lang || "txt";
    blocks.push({
      language: lang,
      extension: ext,
      name: `code_${index}.${ext}`,
      content: code,
    });
    index++;
  }

  return blocks;
}

/**
 * Export content to a PowerPoint Presentation (.pptx)
 */
export async function exportToPptx(title, content, filename = "Presentation.pptx") {
  try {
    const pptx = new pptxgen();
    pptx.layout = "LAYOUT_16x9"; // 10.0" wide by 5.625" high in PptxGenJS
    pptx.title = title || "Presentation";

    const cleanTitle = cleanDocumentText(title) || "Presentation";

    // 1. Title Slide (Slide 1)
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: "0F172A" }; // Executive dark theme

    // Accent line
    titleSlide.addShape(pptx.ShapeType.rect, {
      x: 0.8,
      y: 1.8,
      w: 0.08,
      h: 1.8,
      fill: { color: "F97316" }, // Orange accent for PPT
    });

    titleSlide.addText(cleanTitle, {
      x: 1.1,
      y: 1.8,
      w: 8.0,
      h: 1.2,
      fontSize: 28,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
      wrap: true,
    });

    titleSlide.addText("Executive Presentation • Generated by TharikAI", {
      x: 1.1,
      y: 3.1,
      w: 8.0,
      h: 0.5,
      fontSize: 13,
      color: "94A3B8",
    });

    // 2. Parse sections / slides
    const rawClean = cleanDocumentText(content);
    const lines = rawClean.split("\n");
    let currentSlideTitle = "";
    let currentSlideBullets = [];
    const slidesData = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ") || line.match(/^Slide\s+\d+:/i)) {
        if (currentSlideTitle || currentSlideBullets.length > 0) {
          slidesData.push({
            title: currentSlideTitle || "Overview",
            bullets: [...currentSlideBullets],
          });
          currentSlideBullets = [];
        }
        currentSlideTitle = line
          .replace(/^#+\s*/, "")
          .replace(/^Slide\s+\d+:\s*/i, "")
          .replace(/\*\*/g, "")
          .trim();
      } else {
        const cleanBullet = line
          .replace(/^[-*•]\s*/, "")
          .replace(/^\d+\.\s*/, "")
          .replace(/\*\*/g, "")
          .trim();
        if (cleanBullet.length > 0) {
          currentSlideBullets.push(cleanBullet);
        }
      }
    }

    if (currentSlideTitle || currentSlideBullets.length > 0) {
      slidesData.push({
        title: currentSlideTitle || "Summary",
        bullets: [...currentSlideBullets],
      });
    }

    if (slidesData.length === 0) {
      slidesData.push({
        title: cleanTitle,
        bullets: lines.slice(0, 5).map((x) => cleanDocumentText(x.trim())).filter(Boolean),
      });
    }

    // Chunk into max 5 bullets per slide so text never overflows slide
    const finalSlides = [];
    slidesData.forEach((sd) => {
      const maxPerSlide = 5;
      if (sd.bullets.length <= maxPerSlide) {
        finalSlides.push(sd);
      } else {
        for (let i = 0; i < sd.bullets.length; i += maxPerSlide) {
          const chunk = sd.bullets.slice(i, i + maxPerSlide);
          const part = i === 0 ? "" : ` (Cont. ${Math.floor(i / maxPerSlide) + 1})`;
          finalSlides.push({
            title: `${sd.title}${part}`,
            bullets: chunk,
          });
        }
      }
    });

    finalSlides.forEach((sd, sIdx) => {
      const slide = pptx.addSlide();
      slide.background = { color: "F8FAFC" };

      // Header banner: 10" wide by 0.9" high
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: "100%",
        h: 0.9,
        fill: { color: "0F172A" },
      });

      // Title: x=0.6, w=8.8 -> ends at 9.4" with 0.6" right margin
      slide.addText(sd.title, {
        x: 0.6,
        y: 0.15,
        w: 8.8,
        h: 0.6,
        fontSize: 18,
        bold: true,
        color: "FFFFFF",
        valign: "middle",
        wrap: true,
      });

      // White card container in slide body: x=0.6, y=1.15, w=8.8, h=3.85 -> ends at 5.0"
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.6,
        y: 1.15,
        w: 8.8,
        h: 3.85,
        fill: { color: "FFFFFF" },
        line: { color: "E2E8F0", width: 1 },
      });

      // Bullets text items inside card: x=0.85, w=8.3 -> safely inside card
      const textItems = sd.bullets.map((b) => ({
        text: b,
        options: {
          fontSize: 12,
          color: "1E293B",
          bullet: { type: "bullet", code: "2022" },
          breakLine: true,
          spacing: { after: 10 },
        },
      }));

      if (textItems.length > 0) {
        slide.addText(textItems, {
          x: 0.85,
          y: 1.35,
          w: 8.3,
          h: 3.45,
          margin: 0,
          valign: "top",
          wrap: true,
        });
      }

      // Footer: y=5.15, h=0.35 -> ends at 5.5" (0.125" bottom margin)
      slide.addText(cleanTitle, {
        x: 0.6,
        y: 5.15,
        w: 5.0,
        h: 0.35,
        fontSize: 9,
        color: "94A3B8",
      });

      slide.addText(`Slide ${sIdx + 2} of ${finalSlides.length + 1}`, {
        x: 5.6,
        y: 5.15,
        w: 3.8,
        h: 0.35,
        fontSize: 9,
        color: "94A3B8",
        align: "right",
      });
    });

    const finalName = filename.endsWith(".pptx") ? filename : `${filename}.pptx`;
    await pptx.writeFile({ fileName: finalName });
    return true;
  } catch (err) {
    console.error("PPTX Export Error:", err);
    throw err;
  }
}

/**
 * Export tabular data or Markdown Table into CSV (.csv)
 */
export function exportTableToCsv(tableDataOrMarkdown, filename = "TharikAI_Data.csv") {
  try {
    let rows = [];

    if (Array.isArray(tableDataOrMarkdown)) {
      rows = tableDataOrMarkdown;
    } else if (typeof tableDataOrMarkdown === "string") {
      const rawLines = tableDataOrMarkdown.trim().split("\n");
      for (const line of rawLines) {
        if (!line.includes("|")) continue;
        if (line.match(/^\|?\s*[-:]+[-| :]*\|?$/)) continue;
        const cols = line
          .split("|")
          .map((c) => c.trim())
          .filter((_, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length <= 2);
        if (cols.length > 0) {
          rows.push(cols);
        }
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const finalName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    downloadTextFile(finalName, csv, "text/csv;charset=utf-8;");
    return true;
  } catch (err) {
    console.error("CSV Export Error:", err);
    throw err;
  }
}

