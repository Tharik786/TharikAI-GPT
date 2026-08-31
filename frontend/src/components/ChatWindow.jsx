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

export default function ChatWindow({ user, messages, streamingId, onSuggestion }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
    <div className="chat-window">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          role={m.role}
          content={m.content}
          isStreaming={m.id === streamingId}
          user={user}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
