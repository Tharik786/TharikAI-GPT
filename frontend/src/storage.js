/**
 * All chat history & client-side user accounts live in the browser's localStorage --
 * completely stateless with no server database to maintain.
 */

// Helper to get conversation key based on current active user
function getConversationsKey() {
  const user = authStorage.getCurrentUser();
  return user ? `open-chat:conversations:${user.email.toLowerCase()}` : "open-chat:conversations:guest";
}

function readAll() {
  try {
    const raw = localStorage.getItem(getConversationsKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(conversations) {
  try {
    localStorage.setItem(getConversationsKey(), JSON.stringify(conversations));
  } catch (e) {
    console.error("Failed to save chat history to localStorage:", e);
  }
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

export const storage = {
  list() {
    // newest updated first
    return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get(id) {
    return readAll().find((c) => c.id === id) || null;
  },

  create(title = "New chat") {
    const conv = { id: uid(), title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    writeAll([conv, ...readAll()]);
    return conv;
  },

  rename(id, title) {
    const all = readAll();
    const conv = all.find((c) => c.id === id);
    if (conv) {
      conv.title = title;
      conv.updatedAt = Date.now();
      writeAll(all);
    }
  },

  remove(id) {
    writeAll(readAll().filter((c) => c.id !== id));
  },

  /** Replaces a conversation's messages array and bumps updatedAt. */
  setMessages(id, messages) {
    const all = readAll();
    const conv = all.find((c) => c.id === id);
    if (conv) {
      conv.messages = messages;
      conv.updatedAt = Date.now();
      writeAll(all);
    }
  },

  writeAll(conversations) {
    writeAll(conversations);
  },
};

const USERS_KEY = "open-chat:users";
const CURRENT_USER_KEY = "open-chat:current-user";

export const authStorage = {
  getUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  getUser(email) {
    const users = this.getUsers();
    return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  },

  saveUser(user) {
    const users = this.getUsers().filter((u) => u.email.toLowerCase() !== user.email.toLowerCase());
    users.push(user);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  },

  getCurrentUser() {
    try {
      const raw = localStorage.getItem(CURRENT_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser(user) {
    if (user) {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  },

  clearCurrentUser() {
    localStorage.removeItem(CURRENT_USER_KEY);
  },

  logout() {
    localStorage.removeItem(CURRENT_USER_KEY);
  },

  async hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },
};

// Helper for memory key
function getMemoriesKey() {
  const user = authStorage.getCurrentUser();
  return user ? `open-chat:memories:${user.email.toLowerCase()}` : "open-chat:memories:guest";
}

export const memoryStorage = {
  list() {
    try {
      const raw = localStorage.getItem(getMemoriesKey());
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  writeAll(memories) {
    try {
      localStorage.setItem(getMemoriesKey(), JSON.stringify(memories));
    } catch (e) {
      console.error("Failed to save memories to localStorage:", e);
    }
  },

  add(content, id = null) {
    const list = this.list();
    const memId = id || `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newMem = {
      id: memId,
      content: content.trim(),
      createdAt: Date.now(),
    };
    const updated = [newMem, ...list.filter((m) => m.content !== newMem.content)];
    this.writeAll(updated);
    return newMem;
  },

  remove(id) {
    const list = this.list();
    const updated = list.filter((m) => m.id !== id);
    this.writeAll(updated);
  },

  clear() {
    localStorage.removeItem(getMemoriesKey());
  },
};


