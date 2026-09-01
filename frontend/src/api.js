const RAW_URL = import.meta.env.VITE_API_URL;
const BASE_URL = (RAW_URL ? RAW_URL.trim().replace(/\/+$/, "") : "") || "https://tharikai-gpt.onrender.com";

/**
 * Streams an assistant reply for the given message history via SSE.
 * `messages` is the full conversation so far: [{role, content}, ...].
 * The server is stateless -- it doesn't store anything, it just relays
 * to the LLM and streams tokens back.
 */
export async function streamChat(messages, { onDelta, onDone, onError }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    onError("Couldn't reach the server. Is the backend running?");
    return;
  }

  if (!res.ok || !res.body) {
    onError((await res.text().catch(() => "")) || "Failed to reach the server.");
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
        if (parsed.error) onError(parsed.error);
        else if (parsed.delta) onDelta(parsed.delta);
        else if (parsed.done) onDone();
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


