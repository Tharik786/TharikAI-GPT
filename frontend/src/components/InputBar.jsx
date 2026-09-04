import React, { useRef, useState, useEffect } from "react";
import { extractFileContent } from "../utils/documentExtractor.js";

// Smart transcript merger to prevent Web Speech API doubling / tripling bugs across browsers
function mergeTranscriptChunks(chunks) {
  let finalStr = "";
  for (let chunk of chunks) {
    chunk = (chunk || "").trim();
    if (!chunk) continue;
    if (!finalStr) {
      finalStr = chunk;
      continue;
    }

    // Ignore exact duplicates or if finalStr already ends with this chunk
    if (finalStr === chunk || finalStr.endsWith(" " + chunk) || finalStr.endsWith(chunk)) {
      continue;
    }

    // If chunk contains the entire previous finalStr (cumulative result bug in some mobile browsers)
    if (chunk.startsWith(finalStr)) {
      finalStr = chunk;
      continue;
    }

    // Check for word-level suffix/prefix overlap between chunks
    const finalWords = finalStr.split(/\s+/);
    const chunkWords = chunk.split(/\s+/);
    let overlapFound = false;
    const maxOverlap = Math.min(finalWords.length, chunkWords.length);

    for (let len = maxOverlap; len > 0; len--) {
      const endWords = finalWords.slice(-len).join(" ").toLowerCase();
      const startWords = chunkWords.slice(0, len).join(" ").toLowerCase();
      if (endWords === startWords) {
        const nonOverlapping = chunkWords.slice(len).join(" ");
        if (nonOverlapping) {
          finalStr += " " + nonOverlapping;
        }
        overlapFound = true;
        break;
      }
    }

    if (!overlapFound) {
      finalStr += " " + chunk;
    }
  }
  return finalStr;
}

const STT_LANGUAGES = [
  { code: "auto", name: "Auto Detect", label: "Auto", flag: "🌐" },
  { code: "en-US", name: "English (US)", label: "EN", flag: "🇺🇸" },
  { code: "en-IN", name: "English (India)", label: "EN-IN", flag: "🇮🇳" },
  { code: "en-GB", name: "English (UK)", label: "EN-GB", flag: "🇬🇧" },
  { code: "ta-IN", name: "Tamil (தமிழ்)", label: "தமிழ்", flag: "🇮🇳" },
  { code: "hi-IN", name: "Hindi (हिन्दी)", label: "हिन्दी", flag: "🇮🇳" },
  { code: "te-IN", name: "Telugu (తెలుగు)", label: "తెలుగు", flag: "🇮🇳" },
  { code: "kn-IN", name: "Kannada (ಕನ್ನಡ)", label: "ಕನ್ನಡ", flag: "🇮🇳" },
  { code: "ml-IN", name: "Malayalam (മലയാളം)", label: "മലയാളം", flag: "🇮🇳" },
  { code: "bn-IN", name: "Bengali (বাংলা)", label: "বাংলা", flag: "🇮🇳" },
  { code: "mr-IN", name: "Marathi (मराठी)", label: "मराठी", flag: "🇮🇳" },
  { code: "gu-IN", name: "Gujarati (ગુજરાતી)", label: "ગુજરાતી", flag: "🇮🇳" },
  { code: "pa-IN", name: "Punjabi (ਪੰਜਾਬੀ)", label: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
  { code: "ur-IN", name: "Urdu (اردو)", label: "اردو", flag: "🇮🇳" },
  { code: "es-ES", name: "Spanish (Español)", label: "ES", flag: "🇪🇸" },
  { code: "fr-FR", name: "French (Français)", label: "FR", flag: "🇫🇷" },
  { code: "de-DE", name: "German (Deutsch)", label: "DE", flag: "🇩🇪" },
  { code: "it-IT", name: "Italian (Italiano)", label: "IT", flag: "🇮🇹" },
  { code: "pt-BR", name: "Portuguese (Português)", label: "PT", flag: "🇧🇷" },
  { code: "ar-SA", name: "Arabic (العربية)", label: "العربية", flag: "🇸🇦" },
  { code: "ru-RU", name: "Russian (Русский)", label: "RU", flag: "🇷🇺" },
  { code: "zh-CN", name: "Chinese (中文)", label: "中文", flag: "🇨🇳" },
  { code: "ja-JP", name: "Japanese (日本語)", label: "日本語", flag: "🇯🇵" },
  { code: "ko-KR", name: "Korean (한국어)", label: "한국어", flag: "🇰🇷" },
  { code: "tr-TR", name: "Turkish (Türkçe)", label: "TR", flag: "🇹🇷" },
  { code: "id-ID", name: "Indonesian (Bahasa)", label: "ID", flag: "🇮🇩" },
  { code: "th-TH", name: "Thai (ไทย)", label: "ไทย", flag: "🇹🇭" },
  { code: "vi-VN", name: "Vietnamese (Tiếng Việt)", label: "VI", flag: "🇻🇳" },
];

export default function InputBar({
  value,
  onChange,
  onSend,
  disabled,
  onOpenVoiceMode,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);
  const langMenuRef = useRef(null);

  const [attachments, setAttachments] = useState([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [deepResearchActive, setDeepResearchActive] = useState(false);
  const [sttLang, setSttLang] = useState(() => {
    try {
      return localStorage.getItem("tharik_stt_lang") || "auto";
    } catch {
      return "auto";
    }
  });

  const recognitionRef = useRef(null);
  const baseTextRef = useRef("");
  const valueRef = useRef(value);
  const sttLangRef = useRef(sttLang);
  const currentLangObj = STT_LANGUAGES.find((l) => l.code === sttLang) || STT_LANGUAGES[0];

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    sttLangRef.current = sttLang;
    try {
      localStorage.setItem("tharik_stt_lang", sttLang);
    } catch {}
  }, [sttLang]);

  // Check Web Speech API availability on mount
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
    }

    return () => {
      stopListening();
    };
  }, []);

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const startListening = () => {
    stopListening();

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      alert("Voice-to-text is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      // Multilingual Speech Recognition Language
      const activeLang = sttLangRef.current;
      if (activeLang === "auto") {
        recognition.lang = navigator.language || "en-US";
      } else {
        recognition.lang = activeLang;
      }

      // Save whatever text was already typed before starting voice input
      baseTextRef.current = (valueRef.current || "").trim();

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        const finalChunks = [];
        const interimChunks = [];

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (!res || !res[0]) continue;

          const transcript = res[0].transcript || "";
          const confidence = res[0].confidence;

          // Ignore duplicate results with 0 confidence (known Android Chrome bug)
          if (confidence !== undefined && confidence === 0 && res.isFinal) {
            continue;
          }

          if (res.isFinal) {
            finalChunks.push(transcript);
          } else {
            interimChunks.push(transcript);
          }
        }

        const finalSpeech = mergeTranscriptChunks(finalChunks);
        const interimSpeech = mergeTranscriptChunks(interimChunks);

        let spokenText = finalSpeech;
        if (interimSpeech) {
          if (!spokenText) {
            spokenText = interimSpeech;
          } else {
            spokenText = mergeTranscriptChunks([spokenText, interimSpeech]);
          }
        }

        const base = baseTextRef.current;
        const updated = base
          ? (spokenText ? `${base} ${spokenText}` : base)
          : spokenText;

        onChange(updated);

        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height =
            Math.min(textareaRef.current.scrollHeight, 200) + "px";
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
      };

      recognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          alert("Microphone permission was denied. Please allow microphone access in your browser settings.");
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition start failed:", err);
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  const toggleListening = () => {
    if (!voiceSupported) {
      alert("Voice-to-text is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleSelectLanguage = (langCode) => {
    setSttLang(langCode);
    sttLangRef.current = langCode;
    setLangMenuOpen(false);
    if (isListening) {
      stopListening();
      setTimeout(() => {
        startListening();
      }, 200);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    }
    if (attachMenuOpen || langMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachMenuOpen, langMenuOpen]);

  const handleInput = (e) => {
    onChange(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleFileClick = () => {
    setAttachMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const filename = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || filename.endsWith(".pdf");
      const isWord = filename.endsWith(".docx") || filename.endsWith(".doc");

      if (isImage) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              id: `att-${Date.now()}-${Math.random()}`,
              name: file.name,
              size: file.size,
              type: file.type,
              isImage: true,
              dataUrl: reader.result,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        const tempId = `att-${Date.now()}-${Math.random()}`;
        // Immediately add extraction chip with spinner
        setAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            name: file.name,
            size: file.size,
            type: file.type,
            isImage: false,
            isPdf,
            isWord,
            isExtracting: true,
          },
        ]);

        try {
          const result = await extractFileContent(file);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    ...a,
                    isExtracting: false,
                    textContent: result.text,
                    pageCount: result.pageCount,
                  }
                : a
            )
          );
        } catch (err) {
          console.error("Document extraction error:", err);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    ...a,
                    isExtracting: false,
                    hasError: true,
                    errorMsg: err.message || "Failed to extract text",
                  }
                : a
            )
          );
        }
      }
    }

    e.target.value = "";
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = () => {
    if ((!value.trim() && attachments.length === 0) || disabled) return;

    if (attachments.some((a) => a.isExtracting)) {
      alert("Please wait for document processing to finish before sending.");
      return;
    }

    if (isListening) {
      stopListening();
    }

    onSend({
      text: value.trim(),
      attachments: [...attachments],
      deepResearch: deepResearchActive,
    });

    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="input-bar">
      <div className={`input-bar-inner ${deepResearchActive ? "deep-research-glow" : ""}`}>
        {/* Attachment menu popup */}
        {attachMenuOpen && (
          <div className="attach-popup-menu" ref={menuRef}>
            <button className="attach-menu-item" onClick={handleFileClick}>
              <div className="attach-item-icon">
                <PaperclipIcon />
              </div>
              <div className="attach-item-texts">
                <span className="attach-item-title">Add photos & files</span>
                <span className="attach-item-sub">Upload PDF, Word, Vision & Docs</span>
              </div>
            </button>
            <button
              className="attach-menu-item"
              onClick={() => {
                setAttachMenuOpen(false);
                onChange("Generate an image of ");
                if (textareaRef.current) {
                  textareaRef.current.focus();
                }
              }}
            >
              <div className="attach-item-icon">
                <PaletteIcon />
              </div>
              <div className="attach-item-texts">
                <span className="attach-item-title">Create AI image</span>
                <span className="attach-item-sub">Generate images from description</span>
              </div>
            </button>
          </div>
        )}


        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.docx,.doc,.txt,.md,.json,.csv,.py,.js,.jsx,.ts,.tsx,.html,.css"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {/* Attachment button on left */}
        <button
          type="button"
          className={`attach-btn ${attachMenuOpen ? "active" : ""}`}
          onClick={() => setAttachMenuOpen(!attachMenuOpen)}
          aria-label="Add attachments"
          title="Add photos & files"
        >
          <PlusCircleIcon />
        </button>

        {/* Deep Research Toggle Button */}
        <button
          type="button"
          className={`deep-research-toggle-btn ${deepResearchActive ? "active" : ""}`}
          onClick={() => setDeepResearchActive(!deepResearchActive)}
          aria-label="Toggle Deep Research"
          title={deepResearchActive ? "Deep Research Mode: Active" : "Enable Deep Research (Multi-Source Investigation)"}
        >
          <CompassIcon />
          <span className="deep-research-label">Deep Research</span>
        </button>

        <div className="input-field-wrapper">
          {/* Selected attachment preview chips */}
          {attachments.length > 0 && (
            <div className="attachment-chips-row">
              {attachments.map((att, idx) => (
                <div
                  key={att.id || idx}
                  className={`attachment-chip ${att.isExtracting ? "is-extracting" : ""} ${
                    att.hasError ? "has-error" : ""
                  }`}
                >
                  {att.isExtracting ? (
                    <span className="chip-spinner" />
                  ) : att.isImage ? (
                    <img src={att.dataUrl} alt={att.name} className="chip-img-preview" />
                  ) : att.isPdf ? (
                    <span className="chip-badge chip-pdf">PDF</span>
                  ) : att.isWord ? (
                    <span className="chip-badge chip-doc">DOC</span>
                  ) : (
                    <FileIcon />
                  )}

                  <div className="chip-details">
                    <span className="chip-filename" title={att.name}>
                      {att.name}
                    </span>
                    {att.isExtracting ? (
                      <span className="chip-status">Extracting text...</span>
                    ) : att.hasError ? (
                      <span className="chip-status chip-status-err">Extraction failed</span>
                    ) : att.pageCount ? (
                      <span className="chip-status">
                        {att.pageCount} {att.pageCount === 1 ? "page" : "pages"}
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="chip-remove-btn"
                    onClick={() => removeAttachment(idx)}
                    title="Remove file"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={
              isListening
                ? `Listening in ${currentLangObj.name}...`
                : deepResearchActive
                ? "Ask a deep research question..."
                : "Message TharikAI..."
            }
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Multilingual Voice-to-Text Controls */}
        <div className="voice-stt-wrapper" style={{ position: "relative", display: "flex", alignItems: "center" }}>
          {/* STT Language Picker Popup Menu */}
          {langMenuOpen && (
            <div
              className="stt-lang-popup-menu"
              ref={langMenuRef}
              style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                right: "0",
                background: "rgba(22, 27, 34, 0.96)",
                backdropFilter: "blur(18px)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "14px",
                padding: "8px",
                boxShadow: "0 16px 36px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)",
                zIndex: 50,
                width: "240px",
                maxHeight: "300px",
                overflowY: "auto",
              }}
            >
              <div style={{ padding: "4px 8px 8px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8" }}>
                  Speech Language (Voice to Text)
                </span>
              </div>
              <div className="stt-lang-list" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {STT_LANGUAGES.map((l) => {
                  const isSelected = sttLang === l.code;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => handleSelectLanguage(l.code)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        borderRadius: "8px",
                        background: isSelected ? "rgba(56, 189, 248, 0.15)" : "transparent",
                        color: isSelected ? "#38bdf8" : "#e2e8f0",
                        border: isSelected ? "1px solid rgba(56, 189, 248, 0.3)" : "none",
                        fontSize: "12.5px",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>{l.flag}</span>
                        <span>{l.name}</span>
                      </span>
                      {isSelected && <span style={{ fontSize: "12px", color: "#38bdf8" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Voice-to-text Microphone Button */}
          <button
            type="button"
            className={`voice-btn ${isListening ? "listening" : ""}`}
            onClick={toggleListening}
            aria-label={isListening ? "Stop voice recording" : "Voice to text"}
            title={
              isListening
                ? `Listening in ${currentLangObj.name}... Click to stop`
                : `Voice to text (${currentLangObj.name})`
            }
          >
            {isListening ? <MicOffIcon /> : <MicIcon />}
          </button>

          {/* Voice STT Language Badge Selector */}
          <button
            type="button"
            className={`stt-lang-badge-btn ${langMenuOpen ? "active" : ""}`}
            onClick={() => setLangMenuOpen(!langMenuOpen)}
            title={`Speech Language: ${currentLangObj.name}. Click to change language.`}
            aria-label="Change voice-to-text language"
            style={{
              background: "rgba(255, 255, 255, 0.07)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#94a3b8",
              borderRadius: "10px",
              padding: "2px 6px",
              fontSize: "11px",
              fontWeight: "500",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "3px",
              height: "22px",
              marginLeft: "2px",
              marginRight: "4px",
              transition: "all 0.15s ease",
            }}
          >
            <span style={{ fontSize: "11px" }}>{currentLangObj.flag}</span>
            <span style={{ fontSize: "10.5px", fontWeight: "600" }}>{currentLangObj.label}</span>
          </button>
        </div>


        {/* Dynamic Action Button: Voice icon when empty, Send icon when typing */}
        {((value && value.trim()) || attachments.length > 0) ? (
          <button
            type="button"
            className="send-btn"
            disabled={disabled}
            onClick={submit}
            aria-label="Send message"
            title="Send message"
          >
            <SendIcon />
          </button>
        ) : (
          onOpenVoiceMode && (
            <button
              type="button"
              className="input-voice-mode-btn"
              onClick={onOpenVoiceMode}
              aria-label="Start Voice Mode"
              title="Start live voice conversation (Voice Agent)"
            >
              <VoiceWaveIcon />
            </button>
          )
        )}
      </div>
      <p className="disclaimer">TharikAI can make mistakes. Check important info.</p>
    </div>
  );
}

function PlusCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function VoiceWaveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <rect x="4" y="8" width="2.4" height="8" rx="1.2" />
      <rect x="9" y="3" width="2.4" height="18" rx="1.2" />
      <rect x="14" y="6" width="2.4" height="12" rx="1.2" />
      <rect x="19" y="9" width="2.4" height="6" rx="1.2" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}



