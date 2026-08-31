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

export default function MessageBubble({ role, content, isStreaming, user }) {
  const isUser = role === "user";
  const userInitial = getUserInitial(user);

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
        {content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code(props) {
                return <CodeBlock {...props} />;
              },
            }}
          >
            {content}
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
        {isStreaming && content && <span className="streaming-cursor" />}
      </div>
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
