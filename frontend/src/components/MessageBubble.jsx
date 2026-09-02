import React, { useState, useMemo } from "react";
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
  const match = /language-(\w+)/.exec(className || "");
  const codeText = String(children).replace(/\n$/, "");

  if (inline) {
    return (
      <code className="inline-code" {...rest}>
        {children}
      </code>
    );
  }

  const copy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{match ? match[1] : "text"}</span>
        <button onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
      </div>
      <SyntaxHighlighter
        language={match ? match[1] : "text"}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: "0 0 8px 8px", fontSize: "13px" }}
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  );
});

const TableWrapper = ({ children, ...props }) => (
  <div className="table-responsive-wrapper">
    <table {...props}>{children}</table>
  </div>
);

const MARKDOWN_COMPONENTS = {
  code: CodeBlock,
  table: TableWrapper,
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
        {/* Web Search tag on user message */}
        {isUser && webSearch && (
          <div className="user-web-search-tag">
            <GlobeMiniIcon />
            <span>Web Search</span>
          </div>
        )}

        {/* Render document attachment cards above or below the message text */}
        {attachments && attachments.length > 0 && (
          <div className="message-attachments-container">
            {attachments.map((att, idx) => (
              <DocumentAttachmentCard key={idx} attachment={att} />
            ))}
          </div>
        )}

        {/* Real-time search status indicator while querying web */}
        {!isUser && searchStatus && (
          <div className="web-search-status-bar">
            <GlobeMiniIcon />
            <span className="search-status-text">{searchStatus}</span>
            <span className="search-status-pulse" />
          </div>
        )}

        {/* Real-time Web Sources Widget */}
        {!isUser && sources && sources.length > 0 && (
          <WebSourcesSection sources={sources} />
        )}

        {cleanText ? (
          <div className="markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
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

        {/* Message Actions (Read aloud TTS and Copy) */}
        {!isStreaming && cleanText && (
          <div className="message-actions-bar">
            <button
              type="button"
              className={`msg-action-btn msg-tts-btn ${isSpeaking ? "is-active" : ""}`}
              onClick={handleToggleSpeak}
              title={isSpeaking ? "Stop speaking" : "Read aloud (Text to Speech)"}
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
                  <span className="msg-action-label">Stop</span>
                </>
              ) : (
                <>
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
                  <span className="msg-action-label">Read aloud</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="msg-action-btn msg-copy-btn"
              onClick={handleCopyMessage}
              title={copied ? "Copied to clipboard!" : "Copy message"}
              aria-label="Copy message"
            >
              {copied ? (
                <>
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
                  <span className="msg-action-label copied-text">Copied!</span>
                </>
              ) : (
                <>
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
                  <span className="msg-action-label">Copy</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WebSourcesSection({ sources }) {

  const [expanded, setExpanded] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="web-sources-section">
      <div
        className="web-sources-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="web-sources-title">
          <GlobeMiniIcon />
          <span>{sources.length} Web Sources</span>
        </div>
        <button
          type="button"
          className="web-sources-toggle-btn"
          aria-label={expanded ? "Collapse sources" : "Expand sources"}
        >
          <span>{expanded ? "Show less" : "Show all"}</span>
          <ChevronIcon rotated={expanded} />
        </button>
      </div>

      <div className={`web-sources-grid ${expanded ? "is-expanded" : ""}`}>
        {(expanded ? sources : sources.slice(0, 3)).map((source, idx) => (
          <a
            key={idx}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="web-source-card"
            title={`${source.title}\n${source.url}`}
          >
            <div className="source-card-top">
              <img
                src={`https://www.google.com/s2/favicons?domain=${source.domain || source.url}&sz=32`}
                alt=""
                className="source-favicon"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span className="source-domain">{source.domain || "Source"}</span>
            </div>
            <div className="source-card-title">{source.title}</div>
            {source.content && (
              <div className="source-card-snippet">
                {source.content.slice(0, 95)}...
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function GlobeMiniIcon() {
  return (
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
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ChevronIcon({ rotated }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: rotated ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default React.memo(MessageBubble);

