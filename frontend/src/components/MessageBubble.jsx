import React, { useState, useMemo, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  exportToWordDoc,
  exportTableToExcel,
  exportToPptx,
  exportToPdf,
  exportAllInOneZip,
} from "../utils/exportService.js";


function getUserInitial(user) {
  if (!user) return "U";

  if (user.name && typeof user.name === "string" && user.name.trim()) {
    const trimmed = user.name.trim();
    if (!trimmed.includes("@")) {
      const firstWord = trimmed.split(/\s+/)[0];
      if (firstWord) {
        return firstWord.charAt(0).toUpperCase();
      }
    }
  }

  const emailStr = (user.email || user.name || "").trim();
  const namePart = emailStr.includes("@") ? emailStr.split("@")[0] : emailStr;
  if (!namePart) return "U";

  const baseName = namePart.split(/[._-]/)[0];
  const withoutTrailingDigits = baseName.replace(/\d+$/, "");
  const finalName = withoutTrailingDigits || baseName;

  return finalName.charAt(0).toUpperCase() || "U";
}

/**
 * Parses out embedded file blocks (like legacy --- Attached File: ... ---
 * or [Document: ...] tags) so the user prompt text stays clean and
 * the file is rendered as an elegant interactive document card.
 */
function parseMessageContent(rawContent = "", explicitAttachments = []) {
  if (!rawContent) {
    return { cleanText: "", attachments: explicitAttachments || [] };
  }

  let text = rawContent;
  const attachments = Array.isArray(explicitAttachments) ? [...explicitAttachments] : [];

  // Pattern 1: Legacy "--- Attached File: filename ---\n...--- End of File ---"
  const legacyFileRegex = /---\s*Attached File:\s*([^\n\r]+?)\s*---\r?\n([\s\S]*?)(?:\r?\n---\s*End of File\s*---|$)/gi;
  let match;
  while ((match = legacyFileRegex.exec(rawContent)) !== null) {
    const filename = match[1].trim();
    const body = match[2] || "";
    // Only add if not already in attachments list
    if (!attachments.some((a) => a.name === filename)) {
      // Check if body is raw binary PDF garbage (starts with %PDF or has FlateDecode)
      const isCorruptBinary = body.includes("%PDF") || body.includes("FlateDecode");
      attachments.push({
        name: filename,
        textContent: isCorruptBinary
          ? "[This PDF was uploaded in raw binary format. Please re-upload for full text analysis.]"
          : body.trim(),
        isPdf: filename.toLowerCase().endsWith(".pdf"),
        isBinary: isCorruptBinary,
      });
    }
    text = text.replace(match[0], "");
  }

  // Pattern 2: "[Document: filename (X pages)]\n...[End of Document]"
  const docBlockRegex = /\[Document:\s*([^\n\r\]]+?)\]\r?\n([\s\S]*?)(?:\r?\n\[End of Document\]|$)/gi;
  while ((match = docBlockRegex.exec(rawContent)) !== null) {
    const filenameRaw = match[1].trim();
    const body = match[2] || "";
    const nameOnly = filenameRaw.split("(")[0].trim();
    if (!attachments.some((a) => a.name === nameOnly || a.name === filenameRaw)) {
      attachments.push({
        name: filenameRaw,
        textContent: body.trim(),
        isPdf: nameOnly.toLowerCase().endsWith(".pdf"),
      });
    }
    text = text.replace(match[0], "");
  }

  // Pattern 3: "[Attached image: filename]"
  const imgTagRegex = /\[Attached image:\s*([^\n\r\]]+?)\]/gi;
  while ((match = imgTagRegex.exec(rawContent)) !== null) {
    const filename = match[1].trim();
    if (!attachments.some((a) => a.name === filename)) {
      attachments.push({
        name: filename,
        isImage: true,
      });
    }
    text = text.replace(match[0], "");
  }

  return { cleanText: text.trim(), attachments };
}

/**
 * Beautiful attachment card displaying document metadata, type badge,
 * and an optional expandable text preview.
 */
const DocumentAttachmentCard = React.memo(function DocumentAttachmentCard({ attachment }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const name = attachment.name || "Attached File";
  const lowerName = name.toLowerCase();
  const isPdf = attachment.isPdf || lowerName.endsWith(".pdf");
  const isWord = lowerName.endsWith(".docx") || lowerName.endsWith(".doc");
  const isImage = attachment.isImage || lowerName.match(/\.(png|jpe?g|webp|gif)$/i);

  // Image preview
  if (isImage && attachment.dataUrl) {
    return (
      <div className="msg-attachment-image-wrap">
        <img src={attachment.dataUrl} alt={name} className="msg-attachment-image" />
        <span className="msg-attachment-image-name">{name}</span>
      </div>
    );
  }

  const copyExtractedText = () => {
    if (!attachment.textContent) return;
    navigator.clipboard.writeText(attachment.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const badgeLabel = isPdf
    ? "PDF Document"
    : isWord
      ? "Word Document"
      : "Text Document";

  const pagesInfo = attachment.pageCount
    ? ` • ${attachment.pageCount} ${attachment.pageCount === 1 ? "page" : "pages"}`
    : "";

  return (
    <div className={`msg-doc-card ${isPdf ? "is-pdf" : isWord ? "is-word" : ""}`}>
      <div className="msg-doc-header">
        <div className="msg-doc-icon-wrap">
          {isPdf ? (
            <span className="doc-type-icon pdf-badge">PDF</span>
          ) : isWord ? (
            <span className="doc-type-icon doc-badge">DOC</span>
          ) : (
            <span className="doc-type-icon txt-badge">TXT</span>
          )}
        </div>

        <div className="msg-doc-info">
          <div className="msg-doc-filename" title={name}>
            {name}
          </div>
          <div className="msg-doc-sub">
            {badgeLabel}
            {pagesInfo}
          </div>
        </div>

        {attachment.textContent && (
          <button
            type="button"
            className="msg-doc-toggle-btn"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Hide extracted text" : "Preview extracted text"}
          >
            {expanded ? "Hide text ▲" : "View text ▼"}
          </button>
        )}
      </div>

      {expanded && attachment.textContent && (
        <div className="msg-doc-expanded-preview">
          <div className="msg-doc-preview-toolbar">
            <span>Extracted Document Content</span>
            <button type="button" onClick={copyExtractedText}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="msg-doc-pre-text">{attachment.textContent}</pre>
        </div>
      )}
    </div>
  );
});

const CodeBlock = React.memo(function CodeBlock({ inline, className, children, ...rest }) {
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [executionOutput, setExecutionOutput] = useState(null);
  const [isOutputVisible, setIsOutputVisible] = useState(false);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);

  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1].toLowerCase() : "text";
  const codeText = String(children).replace(/\n$/, "");

  if (inline) {
    return (
      <code className="inline-code" {...rest}>
        {children}
      </code>
    );
  }

  const isRunnable = [
    "javascript", "js", "typescript", "ts", "python", "py", "html", "json", "math", "calc"
  ].includes(lang);

  const copy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadCode = () => {
    const extMap = {
      python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx",
      typescript: "ts", ts: "ts", tsx: "tsx", html: "html", css: "css",
      json: "json", sql: "sql", cpp: "cpp", c: "c", java: "java",
      go: "go", rust: "rs", rs: "rs", php: "php", ruby: "rb",
      sh: "sh", bash: "sh", markdown: "md", md: "md", text: "txt",
    };
    const ext = extMap[lang] || "txt";
    downloadSnippet(`code_${Date.now().toString().slice(-4)}.${ext}`, codeText);
  };

  const runCode = async () => {
    if (lang === "html") {
      setHtmlPreviewOpen((prev) => !prev);
      return;
    }

    setIsRunning(true);
    setIsOutputVisible(true);
    setExecutionOutput({ status: "running", logs: ["⚡ Initializing safe execution sandbox..."] });

    const startTime = performance.now();
    const logs = [];

    // Safe Console Capture
    const customConsole = {
      log: (...args) => logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ")),
      info: (...args) => logs.push("ℹ️ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ")),
      warn: (...args) => logs.push("⚠️ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ")),
      error: (...args) => logs.push("❌ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ")),
    };

    try {
      if (lang === "javascript" || lang === "js" || lang === "typescript" || lang === "ts") {
        // Strip TS types roughly for client eval if needed
        const cleanJS = codeText.replace(/:\s*[A-Z][a-zA-Z0-9<>\[\]]*/g, "");
        const runnerFn = new Function("console", "Math", "Date", "JSON", `
          "use strict";
          try {
            ${cleanJS}
          } catch(err) {
            console.error(err.message || err);
          }
        `);
        runnerFn(customConsole, Math, Date, JSON);
      } else if (lang === "python" || lang === "py") {
        // Advanced in-browser Python / Data Analysis Math Evaluator
        logs.push("🐍 Executing Python calculations & data analysis:");
        const lines = codeText.split("\n");
        const context = {};

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;

          // Simple print(...) handler
          const printMatch = line.match(/^print\((.*)\)$/);
          if (printMatch) {
            const expr = printMatch[1].trim();
            try {
              // Replace common Pythonisms
              const jsExpr = expr
                .replace(/\bTrue\b/g, "true")
                .replace(/\bFalse\b/g, "false")
                .replace(/\bNone\b/g, "null")
                .replace(/\blen\(([^)]+)\)/g, "($1).length")
                .replace(/\bsum\(([^)]+)\)/g, "($1).reduce((a,b)=>a+b,0)")
                .replace(/\bmax\(([^)]+)\)/g, "Math.max(...$1)")
                .replace(/\bmin\(([^)]+)\)/g, "Math.min(...$1)");

              // Evaluate with context
              const evalFn = new Function(...Object.keys(context), `return (${jsExpr});`);
              const res = evalFn(...Object.values(context));
              logs.push(typeof res === "object" ? JSON.stringify(res, null, 2) : String(res));
            } catch (e) {
              logs.push(expr.replace(/^['"]|['"]$/g, ""));
            }
          } else if (line.includes("=")) {
            // Assignment handler
            const [varName, ...valParts] = line.split("=");
            const name = varName.trim();
            const valExpr = valParts.join("=").trim()
              .replace(/\bTrue\b/g, "true")
              .replace(/\bFalse\b/g, "false")
              .replace(/\bNone\b/g, "null");
            try {
              const evalFn = new Function(...Object.keys(context), `return (${valExpr});`);
              context[name] = evalFn(...Object.values(context));
            } catch { }
          }
        }

        if (logs.length <= 1) {
          logs.push("✓ Code executed successfully with no print outputs.");
        }
      } else if (lang === "json") {
        const parsed = JSON.parse(codeText);
        logs.push("✓ Valid JSON format verified.");
        logs.push(`• Keys count: ${Object.keys(parsed).length}`);
        logs.push(JSON.stringify(parsed, null, 2));
      }

      const elapsed = Math.round(performance.now() - startTime);
      setExecutionOutput({
        status: "success",
        logs: logs.length > 0 ? logs : ["✓ Code executed successfully (no stdout returned)."],
        timeMs: elapsed,
      });
    } catch (err) {
      setExecutionOutput({
        status: "error",
        logs: [String(err.message || err)],
        timeMs: Math.round(performance.now() - startTime),
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang-tag">{lang}</span>
        <div className="code-header-actions">
          {isRunnable && (
            <button
              type="button"
              className={`code-action-btn run-code-btn ${isRunning ? "running" : ""}`}
              onClick={runCode}
              title={`Run ${lang.toUpperCase()} code in sandbox`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>{isRunning ? "Running..." : lang === "html" ? (htmlPreviewOpen ? "Hide Preview" : "Live Preview") : "Run Code"}</span>
            </button>
          )}

          <button
            type="button"
            className="code-action-btn"
            onClick={handleDownloadCode}
            title={`Download code snippet as .${lang} file`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download</span>
          </button>
          <button type="button" className="code-action-btn" onClick={copy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: isOutputVisible || htmlPreviewOpen ? "0" : "0 0 8px 8px", fontSize: "13px" }}
      >
        {codeText}
      </SyntaxHighlighter>

      {/* HTML / UI Live Preview Sandbox */}
      {htmlPreviewOpen && (
        <div className="code-html-preview-wrap">
          <div className="code-terminal-header">
            <span className="terminal-title">🌐 Live HTML / Component Sandbox</span>
            <button className="terminal-close-btn" onClick={() => setHtmlPreviewOpen(false)}>&times;</button>
          </div>
          <iframe
            srcDoc={codeText}
            title="HTML Live Sandbox"
            sandbox="allow-scripts"
            className="code-preview-iframe"
          />
        </div>
      )}

      {/* Code Sandbox Output Console */}
      {isOutputVisible && executionOutput && (
        <div className={`code-terminal-output ${executionOutput.status}`}>
          <div className="code-terminal-header">
            <span className="terminal-title">
              {executionOutput.status === "success" ? "⚡ Execution Output" : executionOutput.status === "error" ? "❌ Runtime Error" : "⏳ Running..."}
            </span>
            <div className="terminal-actions">
              {executionOutput.timeMs !== undefined && (
                <span className="terminal-time">{executionOutput.timeMs}ms</span>
              )}
              <button
                type="button"
                className="terminal-close-btn"
                onClick={() => setIsOutputVisible(false)}
                title="Close console"
              >
                &times;
              </button>
            </div>
          </div>
          <pre className="terminal-logs">
            {executionOutput.logs.map((log, idx) => (
              <div key={idx} className="terminal-log-line">
                {log}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
});


function downloadSnippet(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}


const TableWrapper = ({ children, ...props }) => {
  return (
    <div className="table-responsive-wrapper">
      <table {...props}>{children}</table>
    </div>
  );
};

const MarkdownLink = ({ href, children, ...props }) => {
  const text = typeof children === "string" ? children : (Array.isArray(children) ? children.join("") : "");
  const isDoc = (href && href.includes("/api/documents/")) || text.startsWith("document:");

  if (isDoc) {
    const cleanText = text.replace(/^document:\s*/i, "").trim() || "Download PDF Document";
    const downloadUrl = (href || "").replace("/api/documents/view/", "/api/documents/download/");
    return (
      <a
        href={downloadUrl}
        download
        className="clean-doc-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {cleanText.startsWith("📄") || cleanText.startsWith("📥") ? cleanText : `📄 ${cleanText}`}
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
};

const MarkdownImage = ({ src, alt, ...props }) => (
  <img
    src={src}
    alt={alt || ""}
    loading="lazy"
    style={{ maxWidth: "100%", borderRadius: "8px", margin: "8px 0" }}
    {...props}
  />
);

const MARKDOWN_COMPONENTS = {
  code: CodeBlock,
  table: TableWrapper,
  img: MarkdownImage,
  a: MarkdownLink,
};

function MessageBubble({
  id,
  role,
  content,
  attachments: propAttachments,
  sources,
  searchStatus,
  webSearch,
  isStreaming,
  isAnyStreaming,
  user,
  isSpeaking,
  onSpeak,
  onStopSpeech,
  onRetry,
  onEdit,
  userPrompt,
}) {

  const isUser = role === "user";
  const userInitial = getUserInitial(user);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(content || "");
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // Extract clean text and parsed attachments:
  // For assistant messages, skip expensive document parsing regexes during streaming
  const { cleanText, attachments } = useMemo(() => {
    if (!isUser) {
      return { cleanText: (content || "").trim(), attachments: [] };
    }
    return parseMessageContent(content, propAttachments);
  }, [isUser, content, propAttachments]);

  useEffect(() => {
    if (isUser) {
      setEditText(cleanText || content || "");
    }
  }, [isUser, cleanText, content]);

  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleCopyMessage = () => {
    const textToCopy = cleanText || content || "";
    if (!textToCopy) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }).catch(() => {
        fallbackCopy(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      });
    } else {
      fallbackCopy(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };


  const handleStartEdit = () => {
    setEditText(cleanText || content || "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditText(cleanText || content || "");
    setIsEditing(false);
  };

  const handleSaveEdit = () => {
    const trimmed = (editText || "").trim();
    if (!trimmed) return;
    setIsEditing(false);
    if (onEdit) {
      onEdit(id, trimmed);
    } else if (onRetry) {
      onRetry(id);
    }
  };

  const handleToggleSpeak = () => {
    if (isSpeaking) {
      if (onStopSpeech) onStopSpeech();
    } else {
      if (onSpeak) onSpeak(id, cleanText);
    }
  };

  // Document & presentation export handling
  const [exportingFormat, setExportingFormat] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    if (exportMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [exportMenuOpen]);

  // Detect ONLY the specific format the user asked for in their question
  const requestedFormats = useMemo(() => {
    if (isUser) return [];

    const p = (userPrompt || "").trim().toLowerCase();

    // 1. Explicit request for ALL formats
    const isExplicitAll =
      /\b(all\s+formats?|all\s+files?|all\s+in\s+one|all\s+docs?|all\s+documents?)\b/i.test(p) ||
      (/\b(excel|xlsx)\b/i.test(p) && /\b(docx?)\b/i.test(p) && /\b(ppt|pptx)\b/i.test(p));

    if (isExplicitAll) {
      return ["ppt", "word", "excel", "pdf", "all"];
    }

    // 2. PowerPoint (.pptx) - If user specifically asked for PPT, show ONLY PPT!
    if (/\b(ppt|pptx|powerpoint|presentation|slides?|slide\s*deck|keynote)\b/i.test(p)) {
      return ["ppt"];
    }

    // 3. Excel (.xlsx) - If user specifically asked for Excel, show ONLY Excel!
    if (/\b(excel|xlsx|spreadsheet|spreadsheets?|sheets?|csv)\b/i.test(p)) {
      return ["excel"];
    }

    // 4. Word (.docx) - If user specifically asked for Word / Doc / Document, show ONLY Word!
    if (
      /\b(docx?|doc|document|documents?|word\s+doc|word\s+document|word\s+format|word\s+file|ms\s*word)\b/i.test(p) ||
      (/\bword\b/i.test(p) && /\b(doc|document|generate|create|make|write|download|export|format)\b/i.test(p))
    ) {
      return ["word"];
    }

    // 5. PDF (.pdf) - If user specifically asked for PDF, show ONLY PDF!
    if (/\b(pdf|in\s+pdf|pdf\s+format|pdf\s+file)\b/i.test(p)) {
      return ["pdf"];
    }

    // Fallback if userPrompt was empty/lost: inspect cleanText structure
    if (!p && cleanText) {
      if (/^##\s*Slide\s*\d+/im.test(cleanText) || /^Slide\s*\d+:/im.test(cleanText)) {
        return ["ppt"];
      }
    }

    return [];
  }, [isUser, userPrompt, cleanText]);

  // Extract document title and stats for generated files
  const documentMeta = useMemo(() => {
    if (!cleanText) return { title: "Document", stats: "" };
    let title = "Document";
    const h1Match = cleanText.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      title = h1Match[1].replace(/[*_`]/g, "").trim().slice(0, 48);
    } else {
      const slideMatch = cleanText.match(/^##?\s*(?:Slide\s*\d+:)?\s*(.+)$/im);
      if (slideMatch && slideMatch[1]) {
        title = slideMatch[1].replace(/[*_`#]/g, "").trim().slice(0, 48);
      } else {
        const firstLine = cleanText.split("\n").find((l) => l.trim() && !l.trim().startsWith("```") && !l.trim().startsWith("|"));
        if (firstLine) {
          title = firstLine.replace(/[*_#`]/g, "").trim().slice(0, 44);
        }
      }
    }

    let stats = "Generated Document";
    if (requestedFormats.includes("ppt")) {
      const slideMatches = cleanText.match(/^##?\s*(?:Slide\s*\d+|#)/gim);
      const count = slideMatches ? slideMatches.length : 6;
      stats = `${Math.max(count, 5)} Slides • PowerPoint Presentation`;
    } else if (requestedFormats.includes("excel")) {
      const rowsCount = cleanText.split("\n").filter((l) => l.includes("|")).length;
      stats = `${Math.max(rowsCount, 8)} Data Rows • Excel Spreadsheet`;
    } else if (requestedFormats.includes("word")) {
      stats = "Complete Document • Microsoft Word (.docx)";
    } else if (requestedFormats.includes("pdf")) {
      stats = "Executive Document • PDF (.pdf)";
    } else if (requestedFormats.includes("all")) {
      stats = "Full Package (PPT, Word, Excel, PDF) • ZIP";
    }

    return { title, stats };
  }, [cleanText, requestedFormats]);

  const handleExport = async (format) => {
    if (!cleanText || exportingFormat) return;
    setExportingFormat(format);
    try {
      let title = "Document";
      const h1Match = cleanText.match(/^#\s+(.+)$/m);
      if (h1Match && h1Match[1]) {
        title = h1Match[1].replace(/[*_`]/g, "").trim().slice(0, 48);
      } else {
        const firstLine = cleanText.split("\n").find((l) => l.trim() && !l.trim().startsWith("```") && !l.trim().startsWith("|"));
        if (firstLine) {
          title = firstLine.replace(/[*_#`]/g, "").trim().slice(0, 40);
        }
      }
      const cleanTitle = title || "TharikAI_Export";
      const safeFilename = cleanTitle.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36) || "TharikAI_Document";

      if (format === "word") {
        await exportToWordDoc(cleanTitle, cleanText, `${safeFilename}.docx`);
      } else if (format === "excel") {
        exportTableToExcel(cleanText, `${safeFilename}.xlsx`);
      } else if (format === "ppt") {
        await exportToPptx(cleanTitle, cleanText, `${safeFilename}.pptx`);
      } else if (format === "pdf") {
        exportToPdf(cleanTitle, cleanText, `${safeFilename}.pdf`);
      } else if (format === "all") {
        await exportAllInOneZip(cleanTitle, cleanText, `${safeFilename}_All_Formats.zip`);
      }
      setExportSuccess(format);
      setTimeout(() => setExportSuccess(null), 2500);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Export to ${format.toUpperCase()} failed: ${err.message || "Unknown error"}`);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div
      className={`message-row ${isUser ? "message-row-user" : "message-row-assistant"} ${isSpeaking ? "is-message-speaking" : ""
        }`}
    >
      <div className={`avatar ${isUser ? "avatar-user" : "avatar-assistant"}`}>
        {isUser ? (
          userInitial
        ) : (
          <img src="/ai-avatar.png" alt="TharikAI" className="avatar-ai-img" />
        )}
      </div>

      {isUser ? (
        <div className="user-message-wrapper">
          <div
            className={`message-bubble bubble-user ${isStreaming ? "is-streaming" : ""} ${isEditing ? "is-editing-bubble" : ""}`}
          >
            {/* Render document attachment cards */}
            {attachments && attachments.length > 0 && (
              <div className="message-attachments-container">
                {attachments.map((att, idx) => (
                  <DocumentAttachmentCard key={idx} attachment={att} />
                ))}
              </div>
            )}

            {isEditing ? (
              <div className="message-edit-box">
                <textarea
                  className="message-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveEdit();
                    } else if (e.key === "Escape") {
                      handleCancelEdit();
                    }
                  }}
                  autoFocus
                />
                <div className="message-edit-actions">
                  <button
                    type="button"
                    className="message-edit-btn message-edit-cancel"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="message-edit-btn message-edit-save"
                    onClick={handleSaveEdit}
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              cleanText ? (
                <div className="markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS}
                    urlTransform={(url) => url}
                  >
                    {cleanText}
                  </ReactMarkdown>
                </div>
              ) : null
            )}
          </div>

          {/* User Message Actions: 1) History/Retry, 2) Copy, 3) Edit */}
          {!isEditing && (cleanText || content || (attachments && attachments.length > 0)) && (
            <div className="message-actions-bar user-actions-bar">
              {/* 1. Retry / History with Clock */}
              {onRetry && (
                <button
                  type="button"
                  className="msg-action-btn msg-retry-btn"
                  onClick={() => onRetry(id)}
                  disabled={isAnyStreaming}
                  title="Retry question"
                  aria-label="Retry question"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 3" />
                  </svg>
                </button>
              )}

              {/* 2. Copy (Overlapping rounded squares) */}
              <button
                type="button"
                className="msg-action-btn msg-copy-btn"
                onClick={handleCopyMessage}
                title={copied ? "Copied!" : "Copy question"}
                aria-label="Copy question"
              >
                {copied ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="13" height="13" x="8" y="8" rx="2.5" ry="2.5" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                )}
              </button>

              {/* 3. Edit (Angled pencil) */}
              <button
                type="button"
                className="msg-action-btn msg-edit-btn"
                onClick={handleStartEdit}
                disabled={isAnyStreaming}
                title="Edit question"
                aria-label="Edit question"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`message-bubble bubble-assistant ${isStreaming ? "is-streaming" : ""}`}
        >
          {/* Render document attachment cards above or below the message text */}
          {attachments && attachments.length > 0 && (
            <div className="message-attachments-container">
              {attachments.map((att, idx) => (
                <DocumentAttachmentCard key={idx} attachment={att} />
              ))}
            </div>
          )}

          {/* Real-time Web Search Status indicator */}
          {searchStatus && (
            <div className="message-search-status">
              <span className="search-status-spinner" />
              <span className="search-status-text">{searchStatus}</span>
            </div>
          )}

          {/* Verified Web Sources Carousel/Pills */}
          {sources && sources.length > 0 && (
            <div className="message-sources-wrapper">
              <div className="sources-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>{sources.length} Sources</span>
              </div>
              <div className="sources-chips-list">
                {sources.map((s, idx) => (
                  <a
                    key={idx}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-chip"
                    title={`${s.title}\n${s.url}`}
                  >
                    <span className="source-domain">{s.domain || "web"}</span>
                    <span className="source-title">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {requestedFormats.length > 0 ? (
            <div className="generated-doc-container">
              <div className="generated-doc-card">
                <div className="generated-doc-header">
                  <div className="generated-doc-icon-wrap">
                    {requestedFormats.includes("ppt") ? (
                      <span className="doc-chip-badge ppt-badge">PPTX</span>
                    ) : requestedFormats.includes("excel") ? (
                      <span className="doc-chip-badge excel-badge">XLSX</span>
                    ) : requestedFormats.includes("word") ? (
                      <span className="doc-chip-badge word-badge">DOCX</span>
                    ) : requestedFormats.includes("pdf") ? (
                      <span className="doc-chip-badge pdf-badge">PDF</span>
                    ) : (
                      <span className="doc-chip-badge zip-badge">ZIP</span>
                    )}
                  </div>

                  <div className="generated-doc-info">
                    <div className="generated-doc-title" title={documentMeta.title}>
                      {documentMeta.title}
                    </div>
                    <div className="generated-doc-sub">{documentMeta.stats}</div>
                  </div>

                  {cleanText && (
                    <button
                      type="button"
                      className="generated-doc-toggle-btn"
                      onClick={() => setDetailsExpanded(!detailsExpanded)}
                      title={detailsExpanded ? "Hide detailed outline" : "Preview detailed outline"}
                    >
                      {detailsExpanded ? "Hide outline ▲" : "Preview outline ▼"}
                    </button>
                  )}
                </div>

                {/* Direct 1-Click Download Button */}
                {!isStreaming && cleanText && (
                  <div className="doc-export-banner">
                    <div className="doc-export-chips">
                      {/* PowerPoint (.pptx) */}
                      {requestedFormats.includes("ppt") && (
                        <button
                          type="button"
                          className={`doc-chip doc-chip-ppt ${exportingFormat === "ppt" ? "is-exporting" : ""} ${exportSuccess === "ppt" ? "is-success" : ""}`}
                          onClick={() => handleExport("ppt")}
                          disabled={!!exportingFormat}
                          title="Download as PowerPoint Presentation (.pptx)"
                        >
                          <span className="doc-chip-badge ppt-badge">PPTX</span>
                          <span className="doc-chip-name">
                            {exportingFormat === "ppt" ? "Generating..." : exportSuccess === "ppt" ? "✓ Saved PPTX!" : "Download PowerPoint (.pptx)"}
                          </span>
                          <svg className="doc-chip-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}

                      {/* Word (.docx) */}
                      {requestedFormats.includes("word") && (
                        <button
                          type="button"
                          className={`doc-chip doc-chip-word ${exportingFormat === "word" ? "is-exporting" : ""} ${exportSuccess === "word" ? "is-success" : ""}`}
                          onClick={() => handleExport("word")}
                          disabled={!!exportingFormat}
                          title="Download as Microsoft Word (.docx)"
                        >
                          <span className="doc-chip-badge word-badge">DOCX</span>
                          <span className="doc-chip-name">
                            {exportingFormat === "word" ? "Generating..." : exportSuccess === "word" ? "✓ Saved DOCX!" : "Download Word (.docx)"}
                          </span>
                          <svg className="doc-chip-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}

                      {/* Excel (.xlsx) */}
                      {requestedFormats.includes("excel") && (
                        <button
                          type="button"
                          className={`doc-chip doc-chip-excel ${exportingFormat === "excel" ? "is-exporting" : ""} ${exportSuccess === "excel" ? "is-success" : ""}`}
                          onClick={() => handleExport("excel")}
                          disabled={!!exportingFormat}
                          title="Download as Excel Spreadsheet (.xlsx)"
                        >
                          <span className="doc-chip-badge excel-badge">XLSX</span>
                          <span className="doc-chip-name">
                            {exportingFormat === "excel" ? "Generating..." : exportSuccess === "excel" ? "✓ Saved XLSX!" : "Download Excel (.xlsx)"}
                          </span>
                          <svg className="doc-chip-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}

                      {/* PDF (.pdf) */}
                      {requestedFormats.includes("pdf") && (
                        <button
                          type="button"
                          className={`doc-chip doc-chip-pdf ${exportingFormat === "pdf" ? "is-exporting" : ""} ${exportSuccess === "pdf" ? "is-success" : ""}`}
                          onClick={() => handleExport("pdf")}
                          disabled={!!exportingFormat}
                          title="Download as PDF Document (.pdf)"
                        >
                          <span className="doc-chip-badge pdf-badge">PDF</span>
                          <span className="doc-chip-name">
                            {exportingFormat === "pdf" ? "Generating..." : exportSuccess === "pdf" ? "✓ Saved PDF!" : "Download PDF (.pdf)"}
                          </span>
                          <svg className="doc-chip-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}

                      {/* All Formats (.zip) */}
                      {requestedFormats.includes("all") && (
                        <button
                          type="button"
                          className={`doc-chip doc-chip-all ${exportingFormat === "all" ? "is-exporting" : ""} ${exportSuccess === "all" ? "is-success" : ""}`}
                          onClick={() => handleExport("all")}
                          disabled={!!exportingFormat}
                          title="Download All Formats in One ZIP (.zip)"
                        >
                          <span className="doc-chip-badge zip-badge">ZIP</span>
                          <span className="doc-chip-name">
                            {exportingFormat === "all" ? "Packaging..." : exportSuccess === "all" ? "✓ All Saved!" : "Download All Formats (.zip)"}
                          </span>
                          <svg className="doc-chip-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isStreaming && (
                  <div className="generated-doc-streaming-bar">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="streaming-doc-label">Preparing file contents...</span>
                  </div>
                )}

                {/* Collapsible raw outline - only visible if explicitly toggled by user */}
                {detailsExpanded && cleanText && (
                  <div className="generated-doc-expanded-content">
                    <div className="markdown-content">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={MARKDOWN_COMPONENTS}
                        urlTransform={(url) => url}
                      >
                        {cleanText}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            cleanText ? (
              <div className="markdown-content">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={MARKDOWN_COMPONENTS}
                  urlTransform={(url) => url}
                >
                  {cleanText}
                </ReactMarkdown>
              </div>
            ) : (
              isStreaming && (
                <div className="typing-indicator" aria-label="Thinking...">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              )
            )
          )}


          {/* Assistant Message Actions (Read aloud TTS, Copy, Export, Retry - Icons Only) */}
          {!isStreaming && (cleanText || onRetry) && (
            <div className="message-actions-bar assistant-actions-bar">
              {cleanText && (
                <button
                  type="button"
                  className={`msg-action-btn msg-tts-btn ${isSpeaking ? "is-active" : ""}`}
                  onClick={handleToggleSpeak}
                  title={isSpeaking ? "Stop speaking" : "Read aloud"}
                  aria-label={isSpeaking ? "Stop speaking" : "Read aloud"}
                >
                  {isSpeaking ? (
                    <>
                      <span className="speaking-wave-bars">
                        <span className="wave-bar bar-1" />
                        <span className="wave-bar bar-2" />
                        <span className="wave-bar bar-3" />
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="5" y="5" width="14" height="14" rx="2" />
                      </svg>
                    </>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  )}
                </button>
              )}

              {cleanText && (
                <button
                  type="button"
                  className="msg-action-btn msg-copy-btn"
                  onClick={handleCopyMessage}
                  title={copied ? "Copied!" : "Copy response"}
                  aria-label="Copy response"
                >
                  {copied ? (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#10a37f"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              )}

              {/* Universal Export Dropdown */}
              {cleanText && (
                <div className="msg-export-wrapper" ref={exportMenuRef}>
                  <button
                    type="button"
                    className={`msg-action-btn msg-export-btn ${exportMenuOpen ? "is-open" : ""}`}
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    title="Export response (Word, Excel, PPT, PDF, All)"
                    aria-label="Export response"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>

                  {exportMenuOpen && (
                    <div className="msg-export-dropdown-menu">
                      <div className="msg-export-menu-header">Export Document</div>
                      <button
                        type="button"
                        className="msg-export-menu-item"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExport("word");
                        }}
                      >
                        <span className="menu-badge word-badge">DOCX</span>
                        <span>Word Document (.docx)</span>
                      </button>
                      <button
                        type="button"
                        className="msg-export-menu-item"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExport("excel");
                        }}
                      >
                        <span className="menu-badge excel-badge">XLSX</span>
                        <span>Excel Spreadsheet (.xlsx)</span>
                      </button>
                      <button
                        type="button"
                        className="msg-export-menu-item"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExport("ppt");
                        }}
                      >
                        <span className="menu-badge ppt-badge">PPTX</span>
                        <span>PowerPoint Presentation (.pptx)</span>
                      </button>
                      <button
                        type="button"
                        className="msg-export-menu-item"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExport("pdf");
                        }}
                      >
                        <span className="menu-badge pdf-badge">PDF</span>
                        <span>PDF Document (.pdf)</span>
                      </button>
                      <div className="msg-export-menu-divider" />
                      <button
                        type="button"
                        className="msg-export-menu-item item-highlight"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExport("all");
                        }}
                      >
                        <span className="menu-badge zip-badge">ZIP</span>
                        <span>Download All Formats (.zip)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Retry / Regenerate Response Button */}
              {onRetry && (
                <button
                  type="button"
                  className="msg-action-btn msg-retry-btn"
                  onClick={() => onRetry(id)}
                  disabled={isAnyStreaming}
                  title="Retry response"
                  aria-label="Retry response"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(MessageBubble);

