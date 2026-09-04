const RAW_URL = import.meta.env.VITE_API_URL;
const BASE_URL = (RAW_URL ? RAW_URL.trim().replace(/\/+$/, "") : "") || "https://tharikai-gpt.onrender.com";

/**
 * Streams an assistant reply for the given message history via SSE.
 * `messages` is the full conversation so far: [{role, content}, ...].
 * The server is stateless -- it doesn't store anything, it just relays
 * to the LLM and streams tokens back.
 */
export async function streamChat(
  messages,
  { onDelta, onDone, onError, onSources, onStatus },
  { webSearch = true, deepResearch = false, email = null } = {}
) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        web_search: !!webSearch,
        deep_research: !!deepResearch,
        email: email || undefined,
      }),
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
        if (parsed.error) {
          onError(parsed.error);
        } else if (parsed.type === "sources" && parsed.sources) {
          if (onSources) onSources(parsed.sources);
        } else if (parsed.type === "search_status") {
          if (onStatus) onStatus(parsed.status);
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

export async function searchWeb(query, maxResults = 5) {
  const res = await fetch(`${BASE_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Search failed.");
  }
  return data;
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

export async function fetchRemoteMemories(email) {
  try {
    const res = await fetch(`${BASE_URL}/api/memories?email=${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.memories || [];
  } catch {
    return [];
  }
}

export async function saveMemoryRemote(memory, email) {
  try {
    const res = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        content: memory.content,
        id: memory.id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return data.memory;
  } catch (e) {
    console.warn("Failed to save memory to remote:", e);
  }
}

export async function deleteMemoryRemote(memoryId) {
  try {
    await fetch(`${BASE_URL}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.warn("Failed to delete memory from remote:", e);
  }
}

export async function generateImageRemote(prompt) {
  const res = await fetch(`${BASE_URL}/api/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Image generation failed.");
  }
  return data;
}

export async function runDeepResearchRemote(query) {
  const res = await fetch(`${BASE_URL}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Deep research failed.");
  }
  return data;
}





