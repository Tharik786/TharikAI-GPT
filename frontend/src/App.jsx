import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import InputBar from "./components/InputBar.jsx";
import AuthModal from "./components/AuthModal.jsx";
import VoiceModeModal from "./components/VoiceModeModal.jsx";
import MemoryModal from "./components/MemoryModal.jsx";
import {
  streamChat,
  fetchRemoteConversations,
  syncConversationRemote,
  syncMessagesRemote,
  deleteConversationRemote,
  fetchRemoteMemories,
  saveMemoryRemote,
  deleteMemoryRemote,
} from "./api.js";
import { storage, authStorage, memoryStorage } from "./storage.js";
import {
  speakMessage,
  stopSpeech,
  pauseSpeech,
  resumeSpeech,
  setSpeechRate,
  subscribeToSpeech,
} from "./utils/speechService.js";

export default function App() {
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [streamingId, setStreamingId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [memories, setMemories] = useState([]);

  // Text-To-Speech state
  const [speechState, setSpeechState] = useState({
    isPlaying: false,
    isPaused: false,
    messageId: null,
    rate: 1.0,
  });

  useEffect(() => {
    const unsubscribe = subscribeToSpeech((state) => {
      setSpeechState(state);
    });
    return () => {
      unsubscribe();
      stopSpeech();
    };
  }, []);

  // Load current user, conversations, and memories
  useEffect(() => {
    const activeUser = authStorage.getCurrentUser();
    setUser(activeUser);
    syncConversations(activeUser);
    syncMemories(activeUser);
  }, []);

  const syncMemories = async (currentUser) => {
    let localList = memoryStorage.list();
    setMemories(localList);

    if (currentUser?.email) {
      try {
        const remote = await fetchRemoteMemories(currentUser.email);
        if (remote && remote.length > 0) {
          memoryStorage.writeAll(remote);
          setMemories(remote);
        } else if (localList.length > 0) {
          for (const m of localList) {
            await saveMemoryRemote(m, currentUser.email);
          }
        }
      } catch (err) {
        console.warn("Memories cloud sync note:", err);
      }
    }
  };

  const handleAddMemory = async (content) => {
    const newMem = memoryStorage.add(content);
    setMemories(memoryStorage.list());
    if (user?.email) {
      await saveMemoryRemote(newMem, user.email);
    }
  };

  const handleDeleteMemory = async (memoryId) => {
    memoryStorage.remove(memoryId);
    setMemories(memoryStorage.list());
    if (user?.email) {
      await deleteMemoryRemote(memoryId);
    }
  };


  const syncConversations = async (currentUser) => {
    let list = storage.list();
    setConversations(list);

    if (currentUser?.email) {
      try {
        const remote = await fetchRemoteConversations(currentUser.email);
        if (remote && remote.length > 0) {
          storage.writeAll(remote);
          setConversations(remote);
        } else if (list.length > 0) {
          for (const c of list) {
            await syncConversationRemote(c, currentUser.email);
            if (c.messages?.length > 0) {
              await syncMessagesRemote(c.id, c.messages, c.updatedAt);
            }
          }
        }
      } catch (err) {
        console.warn("Supabase conversation sync note:", err);
      }
    }
  };

  const openConversation = (id) => {
    stopSpeech();
    const conv = storage.get(id);
    setActiveId(id);
    setMessages(conv ? conv.messages : []);
    setSidebarOpen(false);
  };

  const handleNewChat = () => {
    stopSpeech();
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
  };

  const ensureConversation = () => {
    if (activeId) return activeId;
    const conv = storage.create();
    setConversations(storage.list());
    setActiveId(conv.id);
    if (user?.email) {
      syncConversationRemote(conv, user.email);
    }
    return conv.id;
  };

  const send = async (payload) => {
    setError(null);
    setDraft("");
    const convId = ensureConversation();

    const text = typeof payload === "string" ? payload : payload?.text || "";
    const attachments = typeof payload === "object" && Array.isArray(payload?.attachments) ? payload.attachments : [];
    const webSearch = typeof payload === "object" && payload?.webSearch !== undefined ? payload.webSearch : true;

    const deepResearch = typeof payload === "object" && payload?.deepResearch !== undefined ? payload.deepResearch : false;

    // Extract any image attachments for multimodal vision
    const imageAttachments = attachments.filter((a) => a.isImage && a.dataUrl);

    const userMsg = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      webSearch,
      deepResearch,
      images: imageAttachments.map((a) => ({
        dataUrl: a.dataUrl,
        mimeType: a.type || "image/jpeg",
        name: a.name,
      })),
      attachments: attachments.map((a) => ({
        name: a.name,
        size: a.size,
        type: a.type,
        isImage: a.isImage,
        dataUrl: a.dataUrl,
        pageCount: a.pageCount,
        textContent: a.textContent,
      })),
    };
    const assistantMsg = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: "",
      sources: [],
      searchStatus: "",
    };

    let working = [...messages, userMsg, assistantMsg];
    setMessages(working);
    setStreamingId(assistantMsg.id);

    // Auto-title a fresh chat from its first message or document name.
    const conv = storage.get(convId);
    if (conv && conv.title === "New chat") {
      const displayTitle = text || (attachments[0] ? `Doc: ${attachments[0].name}` : "New chat");
      const title = displayTitle.slice(0, 48) + (displayTitle.length > 48 ? "..." : "");
      storage.rename(convId, title);
    }

    // Prepare full document content and multimodal images for the AI model
    let promptForLLM = text;
    if (attachments.length > 0) {
      attachments.forEach((att) => {
        if (att.isImage) {
          promptForLLM += `\n\n[Attached image: ${att.name}]`;
        } else if (att.textContent) {
          const pageInfo = att.pageCount ? ` (${att.pageCount} pages)` : "";
          promptForLLM += `\n\n--- Document Attached: ${att.name}${pageInfo} ---\n${att.textContent}\n--- End of Document ---`;
        }
      });
    }

    const historyForLLM = [...messages, {
      role: "user",
      content: promptForLLM,
      images: imageAttachments.map((a) => a.dataUrl),
    }].map((m) => {
      let fullContent = m.content;
      if (m.attachments && m.attachments.length > 0 && !fullContent.includes("--- Document Attached:")) {
        m.attachments.forEach((att) => {
          if (att.textContent) {
            fullContent += `\n\n--- Document Attached: ${att.name} ---\n${att.textContent}\n--- End of Document ---`;
          }
        });
      }
      return {
        role: m.role,
        content: fullContent,
        images: m.images || [],
      };
    });

    let pendingDeltas = "";
    let rafId = null;

    const flushDeltas = () => {
      if (!pendingDeltas) return;
      const textToAppend = pendingDeltas;
      pendingDeltas = "";
      working = working.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: m.content + textToAppend } : m
      );
      setMessages(working);
    };

    await streamChat(
      historyForLLM,
      {
        onStatus: (status) => {
          working = working.map((m) =>
            m.id === assistantMsg.id ? { ...m, searchStatus: status } : m
          );
          setMessages(working);
        },
        onSources: (sources) => {
          working = working.map((m) =>
            m.id === assistantMsg.id ? { ...m, sources, searchStatus: "" } : m
          );
          setMessages(working);
        },
        onDelta: (delta) => {
          pendingDeltas += delta;
          // Immediately flush the first token so the AI responds with 0ms visual delay
          const currentAssistantMsg = working.find((m) => m.id === assistantMsg.id);
          if (!currentAssistantMsg || !currentAssistantMsg.content) {
            flushDeltas();
            return;
          }
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              flushDeltas();
            });
          }
        },
        onDone: () => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushDeltas();
          setStreamingId(null);
          // Persist the finished exchange
          storage.setMessages(convId, working);
          setConversations(storage.list());
          if (user?.email) {
            const updatedConv = storage.get(convId);
            if (updatedConv) {
              syncConversationRemote(updatedConv, user.email);
              syncMessagesRemote(convId, working, updatedConv.updatedAt);
            }
          }
        },
        onError: (msg) => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushDeltas();
          setError(msg);
          setStreamingId(null);
          // Still persist whatever was said
          storage.setMessages(convId, working);
          setConversations(storage.list());
          if (user?.email) {
            const updatedConv = storage.get(convId);
            if (updatedConv) {
              syncConversationRemote(updatedConv, user.email);
              syncMessagesRemote(convId, working, updatedConv.updatedAt);
            }
          }
        },
      },
      { webSearch, deepResearch, email: user?.email }
    );
  };



  const handleRename = (id, title) => {
    storage.rename(id, title);
    setConversations(storage.list());
    if (user?.email) {
      const c = storage.get(id);
      if (c) syncConversationRemote(c, user.email);
    }
  };

  const handleDelete = (id) => {
    stopSpeech();
    storage.remove(id);
    setConversations(storage.list());
    if (id === activeId) {
      setActiveId(null);
      setMessages([]);
    }
    if (user?.email) {
      deleteConversationRemote(id);
    }
  };

  const handleAuthSuccess = (authenticatedUser) => {
    stopSpeech();
    setUser(authenticatedUser);
    syncConversations(authenticatedUser);
    setActiveId(null);
    setMessages([]);
  };

  const handleLogout = () => {
    stopSpeech();
    authStorage.logout();
    setUser(null);
    // Load guest conversations
    const guestConvs = storage.list();
    setConversations(guestConvs);
    setActiveId(null);
    setMessages([]);
  };

  const handleSpeakMessage = (msgId, text) => {
    speakMessage(msgId, text);
  };

  const handleStopSpeech = () => {
    stopSpeech();
  };

  const cycleSpeechSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 0.8];
    const currentIdx = speeds.indexOf(speechState.rate);
    const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
    setSpeechRate(nextSpeed);
  };

  const handleVoiceMessageSend = async (voiceText, { onDelta, onDone, onError }) => {
    setError(null);
    const convId = ensureConversation();

    const userMsg = {
      id: `local-${Date.now()}`,
      role: "user",
      content: voiceText,
      webSearch: true,
      attachments: [],
    };
    const assistantMsg = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: "",
      sources: [],
      searchStatus: "",
    };

    let working = [...messages, userMsg, assistantMsg];
    setMessages(working);
    setStreamingId(assistantMsg.id);

    const conv = storage.get(convId);
    if (conv && conv.title === "New chat") {
      const title = voiceText.slice(0, 48) + (voiceText.length > 48 ? "..." : "");
      storage.rename(convId, title);
    }

    const historyForLLM = [...messages, { role: "user", content: voiceText }].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    await streamChat(
      historyForLLM,
      {
        onStatus: (status) => {
          working = working.map((m) =>
            m.id === assistantMsg.id ? { ...m, searchStatus: status } : m
          );
          setMessages(working);
        },
        onSources: (sources) => {
          working = working.map((m) =>
            m.id === assistantMsg.id ? { ...m, sources, searchStatus: "" } : m
          );
          setMessages(working);
        },
        onDelta: (delta) => {
          working = working.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m
          );
          setMessages(working);
          if (onDelta) onDelta(delta);
        },
        onDone: () => {
          setStreamingId(null);
          storage.setMessages(convId, working);
          setConversations(storage.list());
          if (user?.email) {
            const updatedConv = storage.get(convId);
            if (updatedConv) {
              syncConversationRemote(updatedConv, user.email);
              syncMessagesRemote(convId, working, updatedConv.updatedAt);
            }
          }
          if (onDone) onDone();
        },
        onError: (msg) => {
          setError(msg);
          setStreamingId(null);
          storage.setMessages(convId, working);
          setConversations(storage.list());
          if (onError) onError(msg);
        },
      },
      { webSearch: true }
    );
  };

  const handleRetry = async (assistantMessageId) => {
    if (streamingId) return;
    stopSpeech();
    setError(null);

    const convId = ensureConversation();
    const msgIdx = messages.findIndex((m) => m.id === assistantMessageId);
    if (msgIdx === -1) return;

    const historyUpToAssistant = messages.slice(0, msgIdx);
    const newAssistantMsg = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: "",
      sources: [],
      searchStatus: "",
    };

    let working = [...historyUpToAssistant, newAssistantMsg];
    setMessages(working);
    setStreamingId(newAssistantMsg.id);

    const historyForLLM = historyUpToAssistant.map((m) => {
      if (m.attachments && m.attachments.length > 0 && !m.content.includes("--- Document Attached:")) {
        let full = m.content;
        m.attachments.forEach((att) => {
          if (att.textContent) {
            full += `\n\n--- Document Attached: ${att.name} ---\n${att.textContent}\n--- End of Document ---`;
          }
        });
        return { role: m.role, content: full };
      }
      return { role: m.role, content: m.content };
    });

    let pendingDeltas = "";
    let rafId = null;

    const flushDeltas = () => {
      if (!pendingDeltas) return;
      const textToAppend = pendingDeltas;
      pendingDeltas = "";
      working = working.map((m) =>
        m.id === newAssistantMsg.id ? { ...m, content: m.content + textToAppend } : m
      );
      setMessages(working);
    };

    await streamChat(
      historyForLLM,
      {
        onStatus: (status) => {
          working = working.map((m) =>
            m.id === newAssistantMsg.id ? { ...m, searchStatus: status } : m
          );
          setMessages(working);
        },
        onSources: (sources) => {
          working = working.map((m) =>
            m.id === newAssistantMsg.id ? { ...m, sources, searchStatus: "" } : m
          );
          setMessages(working);
        },
        onDelta: (delta) => {
          pendingDeltas += delta;
          const currentAssistantMsg = working.find((m) => m.id === newAssistantMsg.id);
          if (!currentAssistantMsg || !currentAssistantMsg.content) {
            flushDeltas();
            return;
          }
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              flushDeltas();
            });
          }
        },
        onDone: () => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushDeltas();
          setStreamingId(null);
          storage.setMessages(convId, working);
          setConversations(storage.list());
          if (user?.email) {
            const updatedConv = storage.get(convId);
            if (updatedConv) {
              syncConversationRemote(updatedConv, user.email);
              syncMessagesRemote(convId, working, updatedConv.updatedAt);
            }
          }
        },
        onError: (msg) => {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushDeltas();
          setError(msg);
          setStreamingId(null);
          storage.setMessages(convId, working);
          setConversations(storage.list());
        },
      },
      { webSearch: true }
    );
  };

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        user={user}
        onSelect={openConversation}
        onNewChat={handleNewChat}
        onRename={handleRename}
        onDelete={handleDelete}
        onOpenLogin={() => {
          setAuthMode("login");
          setAuthModalOpen(true);
        }}
        onOpenSignup={() => {
          setAuthMode("signup");
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenMemory={() => setMemoryModalOpen(true)}
      />

      <main className="main-panel">
        <Header
          user={user}
          onOpenLogin={() => {
            setAuthMode("login");
            setAuthModalOpen(true);
          }}
          onOpenSignup={() => {
            setAuthMode("signup");
            setAuthModalOpen(true);
          }}
          onLogout={handleLogout}
          onToggleSidebar={() => setSidebarOpen(true)}
          onOpenVoiceMode={() => setVoiceModeOpen(true)}
          onOpenMemory={() => setMemoryModalOpen(true)}
          memoryCount={memories.length}
        />

        {error && <div className="error-banner">{error}</div>}

        <ChatWindow
          user={user}
          messages={messages}
          streamingId={streamingId}
          onSuggestion={send}
          speakingMessageId={speechState.isPlaying ? speechState.messageId : null}
          onSpeak={handleSpeakMessage}
          onStopSpeech={handleStopSpeech}
          onRetry={handleRetry}
        />

        {/* Floating Audio Speech Controller Bar */}
        {speechState.isPlaying && (
          <div className="floating-audio-bar" role="region" aria-label="Audio playback controls">
            <div className="audio-bar-info">
              <span className="speaking-wave-bars">
                <span className={`wave-bar bar-1 ${speechState.isPaused ? "is-paused" : ""}`} />
                <span className={`wave-bar bar-2 ${speechState.isPaused ? "is-paused" : ""}`} />
                <span className={`wave-bar bar-3 ${speechState.isPaused ? "is-paused" : ""}`} />
              </span>
              <span className="audio-bar-label">
                {speechState.isPaused ? "Speech paused" : "Reading response aloud..."}
              </span>
            </div>

            <div className="audio-bar-controls">
              {/* Play / Pause */}
              <button
                type="button"
                className="audio-control-btn"
                onClick={speechState.isPaused ? resumeSpeech : pauseSpeech}
                title={speechState.isPaused ? "Resume speech" : "Pause speech"}
                aria-label={speechState.isPaused ? "Resume speech" : "Pause speech"}
              >
                {speechState.isPaused ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                )}
              </button>

              {/* Speed Rate Toggle */}
              <button
                type="button"
                className="audio-control-btn audio-speed-btn"
                onClick={cycleSpeechSpeed}
                title={`Speed: ${speechState.rate}x (Click to change)`}
                aria-label={`Speech rate ${speechState.rate}x`}
              >
                {speechState.rate}x
              </button>

              {/* Stop Audio */}
              <button
                type="button"
                className="audio-control-btn audio-stop-btn"
                onClick={handleStopSpeech}
                title="Stop speech"
                aria-label="Stop speech"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <InputBar
          value={draft}
          onChange={setDraft}
          onSend={send}
          disabled={!!streamingId}
          onOpenVoiceMode={() => setVoiceModeOpen(true)}
        />
      </main>

      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      <VoiceModeModal
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        onSendMessage={handleVoiceMessageSend}
        activeConversationTitle={storage.get(activeId)?.title || "Live Voice"}
      />

      <MemoryModal
        isOpen={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        memories={memories}
        onAddMemory={handleAddMemory}
        onDeleteMemory={handleDeleteMemory}
        user={user}
      />
    </div>
  );
}


