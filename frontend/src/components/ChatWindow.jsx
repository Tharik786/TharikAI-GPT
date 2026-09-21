import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";

const SUGGESTION_CARDS = [
  {
    icon: "📄",
    title: "Create a document",
    desc: "Word, Excel, PPT & PDF",
    prompt: "Create a comprehensive analysis and report on artificial intelligence trends",
  },
  {
    icon: "🌐",
    title: "Live Web Search",
    desc: "Current news & real-time info",
    prompt: "What are the latest major news headlines today?",
  },
  {
    icon: "✨",
    title: "Create something",
    desc: "Ideas & creative writing",
    prompt: "Help me brainstorm innovative ideas and strategies.",
  },
  {
    icon: "💻",
    title: "Write code",
    desc: "Build & debug code",
    prompt: "Help me write clean, efficient code and explain it.",
  },
];

function getFirstName(user) {
  if (!user) return "";

  if (user.name && typeof user.name === "string" && user.name.trim()) {
    const trimmed = user.name.trim();
    if (!trimmed.includes("@")) {
      const firstWord = trimmed.split(/\s+/)[0];
      if (firstWord) {
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
      }
    }
  }

  const emailStr = (user.email || user.name || "").trim();
  const namePart = emailStr.includes("@") ? emailStr.split("@")[0] : emailStr;
  if (!namePart) return "";

  const baseName = namePart.split(/[._-]/)[0];
  const withoutTrailingDigits = baseName.replace(/\d+$/, "");
  const finalName = withoutTrailingDigits || baseName;

  return finalName.charAt(0).toUpperCase() + finalName.slice(1);
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

function getGreetingHeading(user) {
  const timeGreeting = getTimeGreeting();
  const firstName = getFirstName(user);
  if (firstName) {
    return `${timeGreeting}, ${firstName}`;
  }
  return `${timeGreeting}, what can I help with?`;
}

export default function ChatWindow({
  user,
  messages,
  streamingId,
  onSuggestion,
  speakingMessageId,
  onSpeak,
  onStopSpeech,
  onRetry,
  onEdit,
}) {
  const containerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const prevMessagesCountRef = useRef(messages.length);
  const prevStreamingIdRef = useRef(streamingId);

  // Monitor scroll position to determine if the user is anchored to bottom
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const threshold = 160; // px threshold from bottom
    const isCloseToBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    isAtBottomRef.current = isCloseToBottom;
  };

  // Auto-scroll on new tokens or messages only if user was already at the bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hasNewMessage = messages.length > prevMessagesCountRef.current;
    const isNewStream = streamingId && !prevStreamingIdRef.current;
    prevMessagesCountRef.current = messages.length;
    prevStreamingIdRef.current = streamingId;

    if (hasNewMessage || isNewStream || isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, streamingId]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <h1>{getGreetingHeading(user)}</h1>
        <div className="suggestion-grid">
          {SUGGESTION_CARDS.map((card) => (
            <button
              key={card.title}
              className="suggestion-card"
              onClick={() => onSuggestion(card.prompt)}
            >
              <div className="suggestion-card-title">
                <span className="suggestion-icon">{card.icon}</span>
                <span>{card.title}</span>
              </div>
              <div className="suggestion-card-desc">{card.desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window" ref={containerRef} onScroll={handleScroll}>
      {messages.map((m, idx) => {
        const prevUserMsg = m.role === "assistant"
          ? messages.slice(0, idx).reverse().find((item) => item.role === "user")
          : null;
        const userPrompt = m.userPrompt || (prevUserMsg ? (prevUserMsg.content || "") : "");

        return (
          <MessageBubble
            key={m.id}
            id={m.id}
            role={m.role}
            content={m.content}
            attachments={m.attachments}
            sources={m.sources}
            searchStatus={m.searchStatus}
            webSearch={m.webSearch}
            isStreaming={m.id === streamingId}
            isAnyStreaming={Boolean(streamingId)}
            user={user}
            isSpeaking={m.id === speakingMessageId}
            onSpeak={onSpeak}
            onStopSpeech={onStopSpeech}
            onRetry={onRetry}
            onEdit={onEdit}
            userPrompt={userPrompt}
          />
        );
      })}
      <div className="scroll-bottom-anchor" />
    </div>
  );
}
