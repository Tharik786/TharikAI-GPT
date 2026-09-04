import React, { useState } from "react";

export default function MemoryModal({
  isOpen,
  onClose,
  memories = [],
  onAddMemory,
  onDeleteMemory,
  user,
}) {
  const [newFact, setNewFact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newFact.trim()) return;
    setSubmitting(true);
    try {
      await onAddMemory(newFact.trim());
      setNewFact("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card memory-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="memory-modal-title"
      >
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <div className="memory-modal-header">
          <div className="memory-icon-badge">
            <BrainIcon />
          </div>
          <h2 id="memory-modal-title" className="memory-modal-title">
            AI Memory & Knowledge
          </h2>
          <p className="memory-modal-subtitle">
            TharikAI remembers key facts, preferences, and coding styles across your conversations.
          </p>
        </div>

        {/* Add Memory Input */}
        <form onSubmit={handleAdd} className="memory-add-form">
          <input
            type="text"
            className="memory-add-input"
            placeholder="e.g. I prefer Python, React & Tailwind CSS, or I am building an AI app..."
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            disabled={submitting}
          />
          <button
            type="submit"
            className="memory-add-submit-btn"
            disabled={!newFact.trim() || submitting}
          >
            {submitting ? "Saving..." : "Add Fact"}
          </button>
        </form>

        {/* Memories List */}
        <div className="memory-list-container">
          <div className="memory-list-header">
            <span className="memory-count-label">
              SAVED MEMORIES ({memories.length})
            </span>
            {user && (
              <span className="memory-sync-badge">
                <CloudCheckIcon /> Synced with cloud
              </span>
            )}
          </div>

          {memories.length === 0 ? (
            <div className="memory-empty-state">
              <SparklesIcon />
              <p>No saved memories yet.</p>
              <span>
                You can add your preferences above, or just tell TharikAI &quot;Remember that I...&quot; in any chat.
              </span>
            </div>
          ) : (
            <div className="memory-items-list">
              {memories.map((mem) => (
                <div key={mem.id || mem.content} className="memory-item-card">
                  <div className="memory-item-content">
                    <span className="memory-bullet">•</span>
                    <span className="memory-text">{mem.content}</span>
                  </div>
                  <button
                    className="memory-delete-btn"
                    onClick={() => onDeleteMemory(mem.id)}
                    title="Delete memory"
                    aria-label="Delete memory"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="memory-modal-footer">
          <button className="memory-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
    </svg>
  );
}

function CloudCheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <polyline points="9 12 11.5 14.5 16 10" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
