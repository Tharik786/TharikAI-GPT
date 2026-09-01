import React, { useState } from "react";
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

export default function MessageBubble({ role, content, attachments: propAttachments, isStreaming, user }) {
  const isUser = role === "user";
  const userInitial = getUserInitial(user);

  // Extract clean text and parsed attachments (cleanly resolves raw binary PDF dumps)
  const { cleanText, attachments } = parseMessageContent(content, propAttachments);

  return (
    <div className={`message-row ${isUser ? "message-row-user" : ""}`}>
      <div className={`avatar ${isUser ? "avatar-user" : "avatar-assistant"}`}>
        {isUser ? (
          userInitial
        ) : (
          <img src="/ai-avatar.png" alt="TharikAI" className="avatar-ai-img" />
        )}
      </div>
      <div className={`message-bubble ${isUser ? "bubble-user" : "bubble-assistant"}`}>
        {/* Render document attachment cards above or below the message text */}
        {attachments && attachments.length > 0 && (
          <div className="message-attachments-container">
            {attachments.map((att, idx) => (
              <DocumentAttachmentCard key={idx} attachment={att} />
            ))}
          </div>
        )}

        {cleanText ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code(props) {
                return <CodeBlock {...props} />;
              },
            }}
          >
            {cleanText}
          </ReactMarkdown>
        ) : (
          isStreaming && (
            <div className="typing-indicator" aria-label="Thinking...">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )
        )}
        {isStreaming && cleanText && <span className="streaming-cursor" />}
      </div>
    </div>
  );
}

/**
 * Beautiful attachment card displaying document metadata, type badge,
 * and an optional expandable text preview.
 */
function DocumentAttachmentCard({ attachment }) {
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
}

function CodeBlock({ inline, className, children, ...rest }) {
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
}
