import React, { useState, useMemo, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";


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
            } catch {}
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

const GeneratedImageCard = React.memo(function GeneratedImageCard({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (src) {
      setError(false);
      setLoaded(false);
    }
  }, [src]);

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(alt || "ai-image").slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    }
  };

  return (
    <div className="generated-image-card">
      <div className="generated-image-container" onClick={() => setModalOpen(true)}>
        {!loaded && !error && (
          <div className="image-loading-skeleton">
            <span className="image-skeleton-spinner" />
            <span>Generating artwork with AI...</span>
          </div>
        )}
        {error && (
          <div className="image-loading-skeleton" style={{ color: "#f87171" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Unable to render image</span>
          </div>
        )}
        <img
          src={src}
          alt={alt || "AI Generated Artwork"}
          className={`generated-ai-img ${loaded ? "is-loaded" : "is-loading"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          {...props}
        />
        {loaded && (
          <div className="image-overlay-actions">
            <button
              type="button"
              className="image-action-btn"
              onClick={handleDownload}
              title="Download image"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download</span>
            </button>
            <button
              type="button"
              className="image-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                window.open(src, "_blank");
              }}
              title="Open full size in new tab"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Full screen Lightbox preview modal */}
      {modalOpen && (
        <div className="image-lightbox-overlay" onClick={() => setModalOpen(false)}>
          <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={alt} className="lightbox-img" />
            <button
              type="button"
              className="lightbox-close-btn"
              onClick={() => setModalOpen(false)}
            >
              &times;
            </button>
            <button
              type="button"
              className="lightbox-download-btn"
              onClick={handleDownload}
            >
              Download Full HD Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

const TableWrapper = ({ children, ...props }) => {
  return (
    <div className="table-responsive-wrapper">
      <table {...props}>{children}</table>
    </div>
  );
};

const MARKDOWN_COMPONENTS = {
  code: CodeBlock,
  table: TableWrapper,
  img: GeneratedImageCard,
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
  user,
  isSpeaking,
  onSpeak,
  onStopSpeech,
  onRetry,
}) {

  const isUser = role === "user";
  const userInitial = getUserInitial(user);
  const [copied, setCopied] = useState(false);

  // Extract clean text and parsed attachments:
  // For assistant messages, skip expensive document parsing regexes during streaming
  const { cleanText, attachments } = useMemo(() => {
    if (!isUser) {
      return { cleanText: content || "", attachments: [] };
    }
    return parseMessageContent(content, propAttachments);
  }, [isUser, content, propAttachments]);

  const handleCopyMessage = () => {
    if (!cleanText) return;
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleToggleSpeak = () => {
    if (isSpeaking) {
      if (onStopSpeech) onStopSpeech();
    } else {
      if (onSpeak) onSpeak(id, cleanText);
    }
  };

  return (
    <div
      className={`message-row ${isUser ? "message-row-user" : "message-row-assistant"} ${
        isSpeaking ? "is-message-speaking" : ""
      }`}
    >
      <div className={`avatar ${isUser ? "avatar-user" : "avatar-assistant"}`}>
        {isUser ? (
          userInitial
        ) : (
          <img src="/ai-avatar.png" alt="TharikAI" className="avatar-ai-img" />
        )}
      </div>
      <div
        className={`message-bubble ${isUser ? "bubble-user" : "bubble-assistant"} ${
          isStreaming ? "is-streaming" : ""
        } ${isSpeaking ? "bubble-speaking" : ""}`}
      >


        {/* Render document attachment cards above or below the message text */}
        {attachments && attachments.length > 0 && (
          <div className="message-attachments-container">
            {attachments.map((att, idx) => (
              <DocumentAttachmentCard key={idx} attachment={att} />
            ))}
          </div>
        )}



        {cleanText ? (
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
        )}

        {isStreaming && cleanText && (
          <span className="streaming-dot-indicator" aria-hidden="true">
            <span className="streaming-dot-pulse" />
          </span>
        )}

        {/* Assistant Message Actions (Read aloud TTS, Copy, Retry - Icons Only) */}
        {!isUser && !isStreaming && cleanText && (
          <div className="message-actions-bar">
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

            <button
              type="button"
              className="msg-action-btn msg-copy-btn"
              onClick={handleCopyMessage}
              title={copied ? "Copied!" : "Copy message"}
              aria-label="Copy message"
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

            {/* Retry / Regenerate Response Button */}
            {onRetry && (
              <button
                type="button"
                className="msg-action-btn msg-retry-btn"
                onClick={() => onRetry(id)}
                title="Retry message"
                aria-label="Retry message"
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
    </div>
  );
}

export default React.memo(MessageBubble);

