/**
 * Natural Multilingual Text-to-Speech Engine for TharikAI
 * Built on the Web Speech Synthesis API with intelligent Markdown cleanup,
 * Unicode script & language detection, native BCP-47 locale binding, and chunking.
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
 * Strips raw Markdown, code snippets, attachment markers, emojis, and URLs
 * so the synthesizer speaks fluent, natural, crystal-clear sentences.
 */
export function cleanTextForSpeech(raw = "") {
  if (!raw || typeof raw !== "string") return "";

  let text = raw;

  // Remove document attachment tags & legacy file delimiters
  text = text.replace(/---\s*Attached File:[\s\S]*?---\s*End of File\s*---/gi, "");
  text = text.replace(/---\s*Document Attached:[\s\S]*?---\s*End of Document\s*---/gi, "");
  text = text.replace(/\[Document:[\s\S]*?\[End of Document\]/gi, "");
  text = text.replace(/\[Attached image:.*?\]/gi, "");

  // Replace multiline code blocks with a brief natural mention
  text = text.replace(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g, (match, code) => {
    const lines = code.trim().split("\n");
    if (lines.length <= 2 && code.length < 80) {
      return ` ${code.trim()} `;
    }
    return " , code block omitted , ";
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

  // Remove HTML tags & decode common entities
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&amp;/g, " and ");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Replace math symbols with readable words
  text = text.replace(/\$\$(.*?)\$\$/g, "$1");
  text = text.replace(/\$(.*?)\$/g, "$1");

  // Clean excessive whitespace and ensure proper sentence termination
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Splits text into logical sentence chunks (~140-180 chars)
 * to avoid browser SpeechSynthesis cutoffs on long paragraphs.
 */
function splitIntoChunks(text) {
  if (!text) return [];
  // Split on sentence terminators while preserving them
  const sentences = text.match(/[^.!?\n\r]+[.!?\n\r]+(?:\s+|$)|[^.!?\n\r]+$/g) || [text];
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length < 160) {
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    } else {
      if (buffer) chunks.push(buffer);
      if (trimmed.length > 180) {
        // Break unusually long sentence by commas or clauses
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
 * Get all available voices in client browser
 */
export function getAvailableVoices() {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices() || [];
}

/**
 * Maps short language code to official BCP-47 locale tag
 */
export function getBCP47LangTag(langCode = "en") {
  const map = {
    ta: "ta-IN",
    hi: "hi-IN",
    te: "te-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    bn: "bn-IN",
    mr: "mr-IN",
    gu: "gu-IN",
    pa: "pa-IN",
    ur: "ur-IN",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    pt: "pt-BR",
    ar: "ar-SA",
    ru: "ru-RU",
    zh: "zh-CN",
    ja: "ja-JP",
    ko: "ko-KR",
    tr: "tr-TR",
    id: "id-ID",
    th: "th-TH",
    vi: "vi-VN",
    el: "el-GR",
    en: "en-US",
  };
  const code = (langCode || "en").toLowerCase().split("-")[0];
  return map[code] || langCode || "en-US";
}

/**
 * Detect language script and language family from text
 */
export function detectTextLanguage(text = "") {
  if (!text || typeof text !== "string") return "en";
  const str = text.trim();

  // 1. Script-based Unicode detection
  if (/[\u0B80-\u0BFF]/.test(str)) return "ta"; // Tamil
  if (/[\u0900-\u097F]/.test(str)) return "hi"; // Hindi / Devanagari
  if (/[\u0C00-\u0C7F]/.test(str)) return "te"; // Telugu
  if (/[\u0C80-\u0CFF]/.test(str)) return "kn"; // Kannada
  if (/[\u0D00-\u0D7F]/.test(str)) return "ml"; // Malayalam
  if (/[\u0980-\u09FF]/.test(str)) return "bn"; // Bengali
  if (/[\u0A80-\u0AFF]/.test(str)) return "gu"; // Gujarati
  if (/[\u0A00-\u0A7F]/.test(str)) return "pa"; // Punjabi
  if (/[\u0600-\u06FF]/.test(str)) return "ar"; // Arabic / Urdu
  if (/[\u3040-\u30FF]/.test(str)) return "ja"; // Japanese Hiragana/Katakana
  if (/[\u4E00-\u9FFF]/.test(str)) return "zh"; // Chinese
  if (/[\uAC00-\uD7AF]/.test(str)) return "ko"; // Korean
  if (/[\u0400-\u04FF]/.test(str)) return "ru"; // Russian / Cyrillic
  if (/[\u0E00-\u0E7F]/.test(str)) return "th"; // Thai
  if (/[\u0370-\u03FF]/.test(str)) return "el"; // Greek

  // 2. Common Latin-based language word checks
  const lower = " " + str.toLowerCase() + " ";
  if (/\b(el|la|los|las|un|una|hola|gracias|cómo|por favor|es|son|de|en|que|para)\b/.test(lower)) return "es"; // Spanish
  if (/\b(le|la|les|un|une|bonjour|merci|comment|s'il vous plaît|est|sont|de|en|que|pour)\b/.test(lower)) return "fr"; // French
  if (/\b(der|die|das|ein|eine|hallo|danke|wie|bitte|ist|sind|von|in|dass|für)\b/.test(lower)) return "de"; // German
  if (/\b(il|la|i|gli|le|un|una|ciao|grazie|come|per favore|è|sono|di|in|che|per)\b/.test(lower)) return "it"; // Italian
  if (/\b(o|a|os|as|um|uma|olá|obrigado|como|por favor|é|são|de|em|que|para)\b/.test(lower)) return "pt"; // Portuguese
  if (/\b(bir|bu|ve|için|merhaba|teşekkürler|nasıl|lütfen|mi|mu)\b/.test(lower)) return "tr"; // Turkish
  if (/\b(yang|dan|di|ini|itu|halo|terima kasih|bagaimana|tolong|adalah)\b/.test(lower)) return "id"; // Indonesian

  return "en";
}

/**
 * Find the best natural voice matching the specified language
 */
export function getBestVoiceForLanguage(langCode = "en", preferredVoiceURI = null) {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const code = (langCode || "en").toLowerCase().split("-")[0];

  // 1. If explicit preferred voice URI is requested and matches language
  if (preferredVoiceURI) {
    const matchedURI = voices.find((v) => v.voiceURI === preferredVoiceURI);
    if (matchedURI) return matchedURI;
  }

  // 2. Filter voices by language code prefix (e.g. 'ta', 'hi', 'te', 'es', 'fr', 'en')
  const langVoices = voices.filter(
    (v) => v.lang && (v.lang.toLowerCase().startsWith(code) || v.lang.toLowerCase().replace("_", "-").startsWith(code))
  );

  if (langVoices.length > 0) {
    // Priority order for natural / neural / Google / Microsoft voices in this language
    const preferredKeywords = ["natural", "neural", "google", "online", "premium", "enhanced", "hi-in", "ta-in"];
    for (const kw of preferredKeywords) {
      const best = langVoices.find((v) => (v.name || "").toLowerCase().includes(kw));
      if (best) return best;
    }
    return langVoices[0];
  }

  // 3. If English requested, return best English voice
  if (code === "en") {
    return getBestVoice();
  }

  // 4. For non-English languages where no specific voice object is preloaded,
  // return null so that the synthesizer uses utterance.lang locale directly
  // rather than incorrectly forcing an English voice!
  return null;
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
  const enVoice = voices.find((v) => v.lang && v.lang.startsWith("en"));
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
 * Speak the given message text in its exact detected language with crystal-clear pronunciation.
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

  // 1. Detect language code & BCP-47 locale tag
  const detectedLang = options.lang || detectTextLanguage(cleaned);
  const targetLocale = getBCP47LangTag(detectedLang);

  // 2. Select native voice matching this language
  const voice = options.voice || getBestVoiceForLanguage(detectedLang, options.voiceURI);
  const rate = options.rate || currentRate;

  let chunkIndex = 0;

  function speakNextChunk() {
    if (!isPlaying || currentMessageId !== messageId) return;

    if (chunkIndex >= chunks.length) {
      stopSpeech();
      if (typeof options.onEnd === "function") {
        try {
          options.onEnd();
        } catch (err) {
          console.error("onEnd callback error:", err);
        }
      }
      return;
    }

    const chunkText = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunkText);

    // Explicitly set language tag so phonetics match the exact language!
    utterance.lang = (voice && voice.lang) ? voice.lang : targetLocale;
    if (voice) {
      utterance.voice = voice;
    }
    
    // Smooth, clear rate
    utterance.rate = rate;
    utterance.pitch = 1.0;

    // Prevent garbage collection bug in Chromium
    currentUtterances.push(utterance);

    utterance.onend = () => {
      chunkIndex++;
      speakNextChunk();
    };

    utterance.onerror = (e) => {
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
      if (typeof options.onEnd === "function") options.onEnd();
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
