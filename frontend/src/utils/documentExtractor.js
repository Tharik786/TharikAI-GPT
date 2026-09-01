import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { extractDocumentRemote } from "../api.js";

// Set worker source for pdfjs in Vite
if (typeof window !== "undefined" && pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

/**
 * Extract text from a PDF file using pdfjs-dist in the browser.
 */
export async function extractPdfClientSide(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageStrings = textContent.items.map((item) => item.str);
    const pageText = pageStrings.join(" ").replace(/\s+/g, " ").trim();
    if (pageText) {
      pageTexts.push(`--- Page ${pageNum} ---\n${pageText}`);
    }
  }

  const fullText = pageTexts.join("\n\n").trim();
  return {
    text: fullText || "[Notice: This PDF contains no selectable text. It may contain scanned images.]",
    pageCount: numPages,
  };
}

/**
 * Universally extract readable text from any supported file.
 */
export async function extractFileContent(file) {
  const filename = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || filename.endsWith(".pdf");
  const isWord = filename.endsWith(".docx") || filename.endsWith(".doc");

  // 1. PDF files: Try client-side first, fallback to backend
  if (isPdf) {
    try {
      const clientResult = await extractPdfClientSide(file);
      if (clientResult.text && !clientResult.text.startsWith("[Notice: This PDF contains no selectable text")) {
        return {
          text: clientResult.text,
          pageCount: clientResult.pageCount,
          filename: file.name,
        };
      }
    } catch (clientErr) {
      console.warn("Client-side PDF extraction note, trying backend:", clientErr);
    }

    // Fallback to backend extraction
    try {
      const remoteResult = await extractDocumentRemote(file);
      return {
        text: remoteResult.text,
        pageCount: remoteResult.page_count,
        filename: file.name,
      };
    } catch (remoteErr) {
      throw new Error(`Could not parse PDF: ${remoteErr.message || remoteErr}`);
    }
  }

  // 2. Word Documents (.docx, .doc): Extract via backend
  if (isWord) {
    const remoteResult = await extractDocumentRemote(file);
    return {
      text: remoteResult.text,
      pageCount: remoteResult.page_count || 1,
      filename: file.name,
    };
  }

  // 3. Plain text / code / csv / markdown / json files:
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        text: reader.result,
        pageCount: 1,
        filename: file.name,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read text file."));
    reader.readAsText(file);
  });
}
