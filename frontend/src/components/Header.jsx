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

export default function Header({ user, onOpenLogin, onOpenSignup, onLogout, onToggleSidebar }) {
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

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="chevron-icon">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
