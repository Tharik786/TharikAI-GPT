import React, { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";

const SUGGESTION_CARDS = [
  {
    icon: "✨",
    title: "Create something",
    desc: "Ideas, writing & designs",
    prompt: "Help me create something creative and innovative.",
  },
  {
    icon: "🧩",
    title: "Solve a problem",
    desc: "Find smart solutions",
    prompt: "Help me analyze and solve a problem step by step.",
  },
  {
    icon: "💻",
    title: "Write code",
    desc: "Build & debug code",
    prompt: "Help me write clean, efficient code and explain it.",
  },
  {
    icon: "📚",
    title: "Learn",
    desc: "Explore any topic",
    prompt: "Teach me something interesting step by step in simple terms.",
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
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= threshold;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const messageCountChanged = messages.length !== prevMessagesCountRef.current;
    prevMessagesCountRef.current = messages.length;
    prevStreamingIdRef.current = streamingId;

    // When a new message is added, immediately jump to bottom without smooth animation
    // to prevent conflicting with incoming streaming tokens
    if (messageCountChanged) {
      isAtBottomRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }

    // Keep view anchored to bottom if user has not scrolled up
    if (isAtBottomRef.current) {
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
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          id={m.id}
          role={m.role}
          content={m.content}
          attachments={m.attachments}
          isStreaming={m.id === streamingId}
          user={user}
          isSpeaking={m.id === speakingMessageId}
          onSpeak={onSpeak}
          onStopSpeech={onStopSpeech}
        />
      ))}
      <div className="scroll-bottom-anchor" />
    </div>
  );
}
