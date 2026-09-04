import React, { useState } from "react";

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
  if (!namePart) return "User";

  const baseName = namePart.split(/[._-]/)[0];
  const withoutTrailingDigits = baseName.replace(/\d+$/, "");
  const finalName = withoutTrailingDigits || baseName;

  return finalName.charAt(0).toUpperCase() + finalName.slice(1);
}

export default function Sidebar({
  conversations,
  activeId,
  user,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onOpenLogin,
  onOpenSignup,
  onLogout,
  isOpen,
  onClose,
  onOpenMemory,
}) {

  const firstName = getFirstName(user);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const startEdit = (conv) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const commitEdit = (id) => {
    if (editValue.trim()) onRename(id, editValue.trim());
    setEditingId(null);
  };

  const filteredConversations = conversations.filter((c) =>
    (c.title || "New chat").toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <>
      {isOpen && <div className="sidebar-scrim" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? "sidebar-open" : ""} ${isCollapsed ? "sidebar-collapsed" : ""}`}>
        {isCollapsed ? (
          <div className="sidebar-mini-content">
            {/* Expand toggle icon button */}
            <button
              className="mini-icon-btn toggle-expand-btn"
              onClick={toggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ExpandRightIcon />
            </button>

            {/* Quick New Chat button */}
            <button
              className="mini-new-chat-btn"
              onClick={onNewChat}
              title="New chat"
              aria-label="New chat"
            >
              <PlusIcon />
            </button>

            <div className="mini-section-label">CHATS</div>

            {/* Collapsed Chat Icon buttons */}
            <div className="mini-conversation-list">
              {conversations.slice(0, 10).map((conv) => (
                <button
                  key={conv.id}
                  className={`mini-chat-icon-btn ${conv.id === activeId ? "active" : ""}`}
                  onClick={() => onSelect(conv.id)}
                  title={conv.title || "Chat"}
                  aria-label={conv.title || "Chat"}
                >
                  <MessageIcon />
                </button>
              ))}
            </div>

            {/* Collapsed Bottom User Avatar */}
            <div className="sidebar-mini-footer">
              {user ? (
                <button
                  className="mini-user-avatar-btn"
                  onClick={onLogout}
                  title={`${firstName} • Click to Log out`}
                  aria-label="User profile and logout"
                >
                  <div className="user-avatar">
                    {firstName.charAt(0).toUpperCase()}
                  </div>
                </button>
              ) : (
                <button
                  className="mini-login-btn"
                  onClick={onOpenLogin}
                  title="Log in"
                  aria-label="Log in"
                >
                  <UserIcon />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="sidebar-expanded-content">
            {/* Top row: New Chat button & Memory button */}
            <div className="sidebar-top-row">
              <button className="new-chat-btn" onClick={onNewChat}>
                <PlusIcon />
                <span>New chat</span>
              </button>
              {onOpenMemory && (
                <button
                  type="button"
                  className="sidebar-memory-quick-btn"
                  onClick={onOpenMemory}
                  title="Manage AI Memory"
                  aria-label="AI Memory"
                >
                  <BrainIconSidebar />
                </button>
              )}
            </div>


            {/* Search Input Field */}
            <div className="sidebar-search-box">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="sidebar-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  &times;
                </button>
              )}
            </div>

            {/* RECENT CHATS Header */}
            <div className="sidebar-section-header">
              <span>RECENT CHATS</span>
              {searchQuery && (
                <span className="search-count-badge">
                  {filteredConversations.length}
                </span>
              )}
            </div>

            {/* Conversation List */}
            <nav className="conversation-list">
              {conversations.length === 0 ? (
                <p className="empty-hint">Your conversations will appear here.</p>
              ) : filteredConversations.length === 0 ? (
                <p className="empty-hint">No chats found.</p>
              ) : (
                filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conversation-item ${conv.id === activeId ? "active" : ""}`}
                    onClick={() => onSelect(conv.id)}
                  >
                    <span className="conv-icon">
                      <MessageIcon />
                    </span>

                    {editingId === conv.id ? (
                      <input
                        autoFocus
                        className="rename-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(conv.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="conversation-title">{conv.title}</span>
                    )}

                    <span className="conversation-actions">
                      <button
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(conv);
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conv.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </nav>

            {/* Sidebar Footer with User Profile */}
            <div className="sidebar-footer">
              {user ? (
                <div className="sidebar-user-pill">
                  <div
                    className="sidebar-user-left"
                    title={user.name ? `${user.name} (${user.email})` : user.email}
                  >
                    <div className="user-avatar">
                      {firstName.charAt(0).toUpperCase()}
                    </div>
                    <span className="user-name-text">{firstName}</span>
                  </div>
                  <button className="btn-logout" onClick={onLogout} title="Log out">
                    Log out
                  </button>
                </div>
              ) : (
                <div className="sidebar-guest-actions">
                  <button className="btn-login" onClick={onOpenLogin}>
                    Log in
                  </button>
                  <button className="btn-signup" onClick={onOpenSignup}>
                    Sign up
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7.6 7.6-3 .7.7-3 7.5-7.7Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CollapseLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <path d="M14 9l-3 3 3 3" />
    </svg>
  );
}

function ExpandRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <path d="M13 15l3-3-3-3" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BrainIconSidebar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
    </svg>
  );
}

