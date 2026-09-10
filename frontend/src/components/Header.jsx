import React, { useState, useRef, useEffect } from "react";

function getFirstName(user) {
  if (!user) return "";

  // 1. If explicit name is provided (e.g., entered during signup)
  if (user.name && typeof user.name === "string" && user.name.trim()) {
    const trimmed = user.name.trim();
    if (!trimmed.includes("@")) {
      const firstWord = trimmed.split(/\s+/)[0];
      if (firstWord) {
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
      }
    }
  }

  // 2. Derive from email username (e.g. keser34255@prorises.com -> Keser)
  const emailStr = (user.email || user.name || "").trim();
  const namePart = emailStr.includes("@") ? emailStr.split("@")[0] : emailStr;
  if (!namePart) return "User";

  const baseName = namePart.split(/[._-]/)[0];
  const withoutTrailingDigits = baseName.replace(/\d+$/, "");
  const finalName = withoutTrailingDigits || baseName;

  return finalName.charAt(0).toUpperCase() + finalName.slice(1);
}

export const AVAILABLE_MODELS = [
  {
    id: "openrouter/auto",
    provider: "openrouter",
    name: "Ask AI Efficient",
    badge: "⚡ Fast & Efficient",
    tagline: "Ultra-fast, cost-efficient & smart reasoning powered by OpenRouter",
    features: "Low latency • Instant response • Free tier",
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    name: "TharikAI Pro (Gemini)",
    badge: "✨ Deep Reasoning",
    tagline: "Google Gemini with multi-modal vision & web search analysis",
    features: "Vision understanding • Deep reasoning",
  },
];

export default function Header({
  user,
  onOpenLogin,
  onOpenSignup,
  onLogout,
  onToggleSidebar,
  selectedModel = "openrouter/auto",
  onSelectModel,
}) {
  const firstName = getFirstName(user);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const dropdownRef = useRef(null);

  const activeModel =
    AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setModelMenuOpen(false);
      }
    }
    if (modelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelMenuOpen]);

  const handleModelSelect = (modelId) => {
    if (onSelectModel) {
      onSelectModel(modelId);
    }
    setModelMenuOpen(false);
  };

  return (
    <header className="chatgpt-header">
      <div className="header-left">
        <button
          className="icon-btn header-menu-btn"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
        >
          <MenuIcon />
        </button>

        <div className="header-brand-wrapper" ref={dropdownRef}>
          <button
            type="button"
            className={`header-brand-dropdown ${modelMenuOpen ? "active" : ""}`}
            onClick={() => setModelMenuOpen(!modelMenuOpen)}
            aria-expanded={modelMenuOpen}
            aria-label="Select AI Model"
          >
            <img src="/logo.png" alt="TharikAI" className="header-brand-logo" />
            <div className="header-brand-info">
              <span className="brand-title">TharikAI</span>
              <span className="brand-model-badge" title={activeModel.name}>
                {activeModel.id.includes("gemini") ? "✨ Gemini Pro" : "⚡ Ask AI Efficient"}
              </span>
            </div>
            <ChevronDownIcon isOpen={modelMenuOpen} />
          </button>

          {modelMenuOpen && (
            <div className="model-selector-menu" role="menu">
              <div className="model-menu-header">
                <span className="model-menu-title">Select AI Chatbot</span>
                <span className="model-menu-subtitle">Switch models anytime during conversation</span>
              </div>
              <div className="model-menu-items">
                {AVAILABLE_MODELS.map((model) => {
                  const isSelected = selectedModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-menu-item ${isSelected ? "selected" : ""}`}
                      onClick={() => handleModelSelect(model.id)}
                      role="menuitem"
                    >
                      <div className="model-item-icon-box">
                        {model.id.includes("gemini") ? <SparkleIcon /> : <ZapIcon />}
                      </div>
                      <div className="model-item-content">
                        <div className="model-item-top">
                          <span className="model-item-name">{model.name}</span>
                          <span className={`model-item-badge ${model.provider}`}>
                            {model.badge}
                          </span>
                        </div>
                        <p className="model-item-desc">{model.tagline}</p>
                        <span className="model-item-features">{model.features}</span>
                      </div>
                      <div className="model-item-check">
                        {isSelected && <CheckIcon />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        {user ? (
          <div className="user-profile-menu header-user-menu">
            <div
              className="user-avatar"
              title={user.name ? `${user.name} (${user.email})` : user.email}
            >
              {firstName.charAt(0).toUpperCase()}
            </div>
            <span className="user-email-label" title={user.email}>
              {firstName}
            </span>
            <button className="btn-logout" onClick={onLogout} title="Log out">
              Log out
            </button>
          </div>
        ) : (
          <div className="auth-buttons-group">
            <button className="btn-login" onClick={onOpenLogin}>
              Log in
            </button>
            <button className="btn-signup" onClick={onOpenSignup}>
              Sign up 
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon({ isOpen }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={`chevron-icon ${isOpen ? "chevron-rotated" : ""}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 6.8L21 11.2l-6.6 2.4L12 20.4l-2.4-6.8L3 11.2l6.6-2.4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
