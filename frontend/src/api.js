const RAW_URL = import.meta.env.VITE_API_URL;
// In dev, use "" so Vite dev proxy forwards to local backend.
// In production (Netlify), default to deployed Render URL if VITE_API_URL is not provided.
const DEFAULT_URL = import.meta.env.DEV ? "" : "https://tharikai-gpt.onrender.com";
const BASE_URL = RAW_URL && RAW_URL.trim() ? RAW_URL.trim().replace(/\/+$/, "") : DEFAULT_URL;

/**
 * Streams an assistant reply for the given message history via SSE.
 * `messages` is the full conversation so far: [{role, content}, ...].
 * The server relays to the LLM and streams tokens back.
 */
export async function streamChat(
  messages,
  { onDelta, onDone, onError },
  { email = null } = {}
) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        email: email || undefined,
      }),
    });
  } catch {
    onError("Couldn't reach the server. Is the backend running?");
    return;
  }

  if (!res.ok || !res.body) {
    const errorText = (await res.text().catch(() => "")).trim();
    if (errorText.startsWith("<") || errorText.includes("<!DOCTYPE") || errorText.includes("<!doctype")) {
      onError(`Backend error (${res.status}): Server is temporarily unavailable or restarting. Please try again in a few seconds.`);
    } else {
      onError(errorText || `Failed to reach the server (HTTP ${res.status}).`);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop();

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          onError(parsed.error);
        } else if (parsed.delta) {
          if (onDelta) onDelta(parsed.delta);
        } else if (parsed.done) {
          if (onDone) onDone();
        }
      } catch {
        // ignore malformed keep-alive chunks
      }
    }
  }
}

export async function registerUser(email, name, password_hash) {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password_hash }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Registration failed.");
  }
  return data;
}

export async function loginUser(email, password_hash) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password_hash }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Login failed.");
  }
  return data;
}

export async function fetchRemoteConversations(email) {
  try {
    const res = await fetch(`${BASE_URL}/api/conversations?email=${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.conversations || [];
  } catch {
    return [];
  }
}

export async function syncConversationRemote(conv, email) {
  try {
    await fetch(`${BASE_URL}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: conv.id,
        email,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      }),
    });
  } catch (e) {
    console.warn("Failed to sync conversation to Supabase:", e);
  }
}

export async function syncMessagesRemote(id, messages, updatedAt) {
  try {
    await fetch(`${BASE_URL}/api/conversations/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, messages, updatedAt }),
    });
  } catch (e) {
    console.warn("Failed to sync messages to Supabase:", e);
  }
}

export async function deleteConversationRemote(id) {
  try {
    await fetch(`${BASE_URL}/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.warn("Failed to delete conversation from Supabase:", e);
  }
}

export async function extractDocumentRemote(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BASE_URL}/api/extract-document`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Failed to extract text from document.");
  }
  return data;
}


/**
 * Generates an executive document using Carbone.io API via backend.
 * @param {Object} params
 * @param {string} [params.title]
 * @param {string} [params.content]
 * @param {string} [params.query]
 * @param {boolean} [params.useSearch]
 * @returns {Promise<{ renderId: string, title: string, filename: string, downloadUrl: string, viewUrl: string }>}
 */
export async function generateCarboneDocument({ title, content, query, useSearch = false }) {
  const res = await fetch(`${BASE_URL}/api/documents/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content,
      query,
      use_search: useSearch,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const msg = errJson.detail || errJson.error || res.statusText || "Failed to generate document";
    throw new Error(msg);
  }

  return await res.json();
}

/**
 * Returns the download URL for a rendered document.
 */
export function getDocumentDownloadUrl(renderId, filename = "document.pdf") {
  return `${BASE_URL}/api/documents/download/${renderId}?filename=${encodeURIComponent(filename)}`;
}

/**
 * Returns the inline preview URL for a rendered document.
 */
export function getDocumentViewUrl(renderId, filename = "document.pdf") {
  return `${BASE_URL}/api/documents/view/${renderId}?filename=${encodeURIComponent(filename)}`;
}

