import React from "react";

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

export default function Header({
  user,
  onOpenLogin,
  onOpenSignup,
  onLogout,
  onToggleSidebar,
  onOpenVoiceMode,
  onOpenMemory,
  memoryCount = 0,
}) {
  const firstName = getFirstName(user);

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

        <div className="header-brand-dropdown">
          <img src="/logo.png" alt="TharikAI" className="header-brand-logo" />
          <span className="brand-title">TharikAI</span>
        </div>
      </div>

      <div className="header-right">
        {/* Memory Trigger Button */}
        {onOpenMemory && (
          <button
            type="button"
            className="header-memory-btn"
            onClick={onOpenMemory}
            title="Manage Long-Term Memory & User Facts"
            aria-label="AI Memory"
          >
            <BrainSmallIcon />
            <span className="header-memory-label">Memory</span>
            {memoryCount > 0 && <span className="header-memory-badge">{memoryCount}</span>}
          </button>
        )}

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

function BrainSmallIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
    </svg>
  );
}


function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="chevron-icon">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
