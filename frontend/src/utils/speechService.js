/**
 * Natural Text-to-Speech Engine for TharikAI
 * Built on the Web Speech Synthesis API with intelligent Markdown cleanup,
 * chunking to bypass browser length limits, voice selection, and state tracking.
 */

// Global state
let currentUtterances = [];
let currentMessageId = null;
let isPlaying = false;
let isPaused = false;
let currentRate = 1.0;
let selectedVoice = null;
let stateListeners = new Set();

/**
 * Strips raw Markdown, code snippets, attachment markers, and URLs
 * so the synthesizer speaks fluent, natural sentences without reading symbols aloud.
 */
export function cleanTextForSpeech(raw = "") {
  if (!raw || typeof raw !== "string") return "";

  let text = raw;

  // Remove document attachment tags & legacy file delimiters
  text = text.replace(/---\s*Attached File:[\s\S]*?---\s*End of File\s*---/gi, "");
  text = text.replace(/---\s*Document Attached:[\s\S]*?---\s*End of Document\s*---/gi, "");
  text = text.replace(/\[Document:[\s\S]*?\[End of Document\]/gi, "");
  text = text.replace(/\[Attached image:.*?\]/gi, "");

  // Replace multiline code blocks with a natural brief pause/mention
  text = text.replace(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g, (match, code) => {
    const lines = code.trim().split("\n");
    if (lines.length <= 2 && code.length < 80) {
      return ` ${code.trim()} `;
    }
    return " [code omitted] ";
  });

  // Replace inline backticks
  text = text.replace(/`([^`]+)`/g, "$1");

  // Replace markdown links [anchor](url) -> anchor
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove raw URLs
  text = text.replace(/https?:\/\/[^\s]+/g, "");

  // Remove markdown headers (#, ##, ###)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove bold, italic, strikethrough (*, **, _, __, ~~)
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$2");

  // Remove blockquote angle brackets
  text = text.replace(/^>\s+/gm, "");

  // Remove table formatting (| col | col |)
  text = text.replace(/\|/g, " ");
  text = text.replace(/[-:]{3,}/g, "");

  // Remove list bullet symbols (-, *, +, 1., 2.)
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Remove remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Clean excessive whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Splits text into logical sentence chunks (~150-200 chars)
 * to avoid browser SpeechSynthesis cutoffs on long paragraphs.
 */
function splitIntoChunks(text) {
  if (!text) return [];
  // Split on sentence terminators while preserving them
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length < 180) {
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    } else {
      if (buffer) chunks.push(buffer);
      if (trimmed.length > 200) {
        // Break unusually long sentence by commas/clauses
        const parts = trimmed.match(/[^,;]+[,;]+(?:\s+|$)|[^,;]+$/g) || [trimmed];
        for (const p of parts) {
          if (p.trim()) chunks.push(p.trim());
        }
        buffer = "";
      } else {
        buffer = trimmed;
      }
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

/**
 * Notify all subscribed React components of playback state change
 */
function notifyListeners() {
  const state = {
    isPlaying,
    isPaused,
    messageId: currentMessageId,
    rate: currentRate,
  };
  stateListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (e) {
      console.error("TTS listener error:", e);
    }
  });
}

/**
 * Check if the browser supports SpeechSynthesis
 */
export function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Find the best natural English voice available in the client browser
 */
export function getBestVoice() {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  if (selectedVoice) {
    const match = voices.find((v) => v.name === selectedVoice.name);
    if (match) return match;
  }

  // Priority order for high quality voices
  const preferredNames = [
    "Google US English",
    "Google UK English Female",
    "Microsoft Jenny Online (Natural)",
    "Microsoft Guy Online (Natural)",
    "Microsoft Zira",
    "Microsoft David",
    "Samantha",
    "Alex",
    "Daniel",
  ];

  for (const name of preferredNames) {
    const found = voices.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
    if (found) return found;
  }

  // Fallback to any English voice
  const enVoice = voices.find((v) => v.lang.startsWith("en"));
  if (enVoice) return enVoice;

  return voices[0] || null;
}

/**
 * Stop any active speech immediately
 */
export function stopSpeech() {
  if (!isSpeechSupported()) return;

  try {
    window.speechSynthesis.cancel();
  } catch {}

  currentUtterances = [];
  currentMessageId = null;
  isPlaying = false;
  isPaused = false;
  notifyListeners();
}

/**
 * Pause active speech
 */
export function pauseSpeech() {
  if (!isSpeechSupported() || !isPlaying) return;
  try {
    window.speechSynthesis.pause();
    isPaused = true;
    notifyListeners();
  } catch {}
}

/**
 * Resume paused speech
 */
export function resumeSpeech() {
  if (!isSpeechSupported() || !isPaused) return;
  try {
    window.speechSynthesis.resume();
    isPaused = false;
    notifyListeners();
  } catch {}
}

/**
 * Set playback rate (e.g. 0.8, 1.0, 1.25, 1.5)
 */
export function setSpeechRate(newRate) {
  currentRate = Math.max(0.5, Math.min(2.0, newRate));
  notifyListeners();
}

/**
 * Speak the given message text. If the same message is already speaking,
 * toggles stop/start.
 */
export function speakMessage(messageId, text, options = {}) {
  if (!isSpeechSupported()) {
    console.warn("Speech Synthesis is not supported in this browser.");
    return false;
  }

  // If clicking the currently playing message, stop it
  if (isPlaying && currentMessageId === messageId) {
    stopSpeech();
    return false;
  }

  // Stop any other active speech first
  stopSpeech();

  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return false;

  const chunks = splitIntoChunks(cleaned);
  if (chunks.length === 0) return false;

  currentMessageId = messageId;
  isPlaying = true;
  isPaused = false;
  notifyListeners();

  const voice = options.voice || getBestVoice();
  const rate = options.rate || currentRate;

  let chunkIndex = 0;

  function speakNextChunk() {
    if (!isPlaying || currentMessageId !== messageId) return;

    if (chunkIndex >= chunks.length) {
      stopSpeech();
      return;
    }

    const chunkText = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunkText);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1.0;

    // Prevent garbage collection bug in Chrome
    currentUtterances.push(utterance);

    utterance.onend = () => {
      chunkIndex++;
      speakNextChunk();
    };

    utterance.onerror = (e) => {
      // If stopped deliberately, ignore
      if (e.error === "canceled" || e.error === "interrupted") return;
      console.warn("Speech synthesis chunk note:", e.error);
      chunkIndex++;
      speakNextChunk();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech synthesis failed:", err);
      stopSpeech();
    }
  }

  speakNextChunk();
  return true;
}

/**
 * React hook or subscription helper to track speech state
 */
export function subscribeToSpeech(listener) {
  stateListeners.add(listener);
  // Send current state immediately
  listener({
    isPlaying,
    isPaused,
    messageId: currentMessageId,
    rate: currentRate,
  });

  return () => {
    stateListeners.delete(listener);
  };
}

export function getCurrentSpeechState() {
  return {
    isPlaying,
    isPaused,
    messageId: currentMessageId,
    rate: currentRate,
  };
}
