import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  speakMessage,
  stopSpeech,
  cleanTextForSpeech,
  getAvailableVoices,
  detectTextLanguage,
  getBestVoiceForLanguage,
  isSpeechSupported,
} from "../utils/speechService";

const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "🌐 Auto Detect (All Languages)" },
  { code: "en-US", name: "🇺🇸 English (US)" },
  { code: "en-GB", name: "🇬🇧 English (UK)" },
  { code: "en-IN", name: "🇮🇳 English (India)" },
  { code: "ta-IN", name: "🇮🇳 Tamil (தமிழ்)" },
  { code: "hi-IN", name: "🇮🇳 Hindi (हिन्दी)" },
  { code: "te-IN", name: "🇮🇳 Telugu (తెలుగు)" },
  { code: "kn-IN", name: "🇮🇳 Kannada (ಕನ್ನಡ)" },
  { code: "ml-IN", name: "🇮🇳 Malayalam (മലയാളം)" },
  { code: "bn-IN", name: "🇮🇳 Bengali (বাংলা)" },
  { code: "es-ES", name: "🇪🇸 Spanish (Español)" },
  { code: "fr-FR", name: "🇫🇷 French (Français)" },
  { code: "de-DE", name: "🇩🇪 German (Deutsch)" },
  { code: "it-IT", name: "🇮🇹 Italian (Italiano)" },
  { code: "pt-BR", name: "🇧🇷 Portuguese (Português)" },
  { code: "ar-SA", name: "🇸🇦 Arabic (العربية)" },
  { code: "ru-RU", name: "🇷🇺 Russian (Русский)" },
  { code: "zh-CN", name: "🇨🇳 Chinese (中文)" },
  { code: "ja-JP", name: "🇯🇵 Japanese (日本語)" },
  { code: "ko-KR", name: "🇰🇷 Korean (한국어)" },
  { code: "tr-TR", name: "🇹🇷 Turkish (Türkçe)" },
  { code: "id-ID", name: "🇮🇩 Indonesian (Bahasa)" },
];

export default function VoiceModeModal({
  isOpen,
  onClose,
  onSendMessage,
  activeConversationTitle = "New Conversation",
}) {
  const [status, setStatus] = useState("idle"); // 'listening' | 'thinking' | 'speaking' | 'muted'
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [selectedLang, setSelectedLang] = useState("auto");
  const [voiceList, setVoiceList] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [speechRate, setSpeechRate] = useState(1.05);

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isListeningRef = useRef(false);
  const statusRef = useRef(status);
  const isMutedRef = useRef(isMuted);
  const selectedLangRef = useRef(selectedLang);

  statusRef.current = status;
  isMutedRef.current = isMuted;
  selectedLangRef.current = selectedLang;

  // Load browser voices on mount
  useEffect(() => {
    const loadVoices = () => {
      const v = getAvailableVoices();
      setVoiceList(v);
    };

    loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      stopSpeech();
      setStatus("idle");
      setUserTranscript("");
      setAiTranscript("");
    }
  }, [isOpen]);

  // Voice Activity Detection / Speech Recognition setup
  const startListening = useCallback(() => {
    if (isMutedRef.current) {
      setStatus("muted");
      return;
    }

    const SpeechRec =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setStatus("idle");
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;

      // Bind speech recognition language dynamically
      const activeLang = selectedLangRef.current;
      if (activeLang === "auto") {
        rec.lang = navigator.language || "en-US";
      } else {
        rec.lang = activeLang;
      }

      rec.onstart = () => {
        isListeningRef.current = true;
        setStatus("listening");
      };

      rec.onresult = (event) => {
        let interim = "";
        let final = "";

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }

        const currentText = (final || interim).trim();
        if (currentText) {
          setUserTranscript(currentText);

          // Reset silence timer on every new speech event
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            // User paused speaking for 1.2s -> submit voice turn
            if (isListeningRef.current && currentText.length >= 2) {
              handleVoiceSubmit(currentText);
            }
          }, 1200);
        }
      };

      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        console.warn("Voice Recognition error:", e.error);
        if (e.error === "not-allowed") {
          setIsMuted(true);
          setStatus("muted");
        }
      };

      rec.onend = () => {
        isListeningRef.current = false;
        // If we should still be listening and not in another state, restart
        if (statusRef.current === "listening" && !isMutedRef.current) {
          try {
            rec.start();
          } catch {}
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setStatus("idle");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    isListeningRef.current = false;
  }, []);

  // Submit voice question and stream AI reply
  const handleVoiceSubmit = async (promptText) => {
    if (!promptText || promptText.trim().length === 0) return;
    stopListening();
    setStatus("thinking");
    setAiTranscript("Thinking and processing in your language...");

    let accumulatedText = "";

    try {
      await onSendMessage(
        promptText,
        {
          onDelta: (delta) => {
            accumulatedText += delta;
            setAiTranscript(accumulatedText);
          },
          onDone: () => {
            // Once full response has arrived, speak it aloud in the detected/spoken language
            setStatus("speaking");
            const cleanText = cleanTextForSpeech(accumulatedText);
            
            // Detect the language of the AI's response to pick the matching native voice
            const detectedLang = detectTextLanguage(cleanText);
            const nativeVoice = getBestVoiceForLanguage(detectedLang, selectedVoiceURI);

            speakMessage(`voice-mode-${Date.now()}`, cleanText, {
              voice: nativeVoice,
              lang: detectedLang,
              rate: speechRate,
              onEnd: () => {
                // Speech ended -> automatically resume listening loop
                if (!isMutedRef.current) {
                  setUserTranscript("");
                  setAiTranscript("");
                  setTimeout(() => {
                    startListening();
                  }, 350);
                } else {
                  setStatus("muted");
                }
              },
            });
          },
          onError: (err) => {
            setStatus("idle");
            setAiTranscript(`Error: ${err}`);
            setTimeout(() => {
              if (!isMutedRef.current) startListening();
            }, 2000);
          },
        }
      );
    } catch (e) {
      setStatus("idle");
      setAiTranscript("Could not complete request.");
    }
  };

  // Toggle Mute / Pause
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      startListening();
    } else {
      setIsMuted(true);
      stopListening();
      stopSpeech();
      setStatus("muted");
    }
  };

  // Interrupt AI speaking
  const handleInterrupt = () => {
    stopSpeech();
    setUserTranscript("");
    setAiTranscript("");
    if (!isMuted) {
      startListening();
    } else {
      setStatus("muted");
    }
  };

  // Switch Language
  const handleLanguageChange = (langCode) => {
    setSelectedLang(langCode);
    selectedLangRef.current = langCode;
    stopListening();
    if (!isMuted) {
      setTimeout(() => {
        startListening();
      }, 300);
    }
  };

  // Start listening automatically when modal opens
  useEffect(() => {
    if (isOpen && !isMuted) {
      const timer = setTimeout(() => {
        startListening();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isMuted, startListening]);

  if (!isOpen) return null;

  return (
    <div className="voice-modal-overlay">
      {/* Background ambient glow backdrop */}
      <div className={`voice-ambient-glow glow-${status}`} />

      <div className="voice-modal-container">
        {/* Top Controls: Language Switcher + Close Button */}
        <div className="voice-modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "16px 24px" }}>
          <div className="voice-lang-selector-wrapper" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <select
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="voice-lang-dropdown"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                color: "#e2e8f0",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "20px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                backdropFilter: "blur(10px)",
                outline: "none",
              }}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} style={{ background: "#1e293b", color: "#f8fafc" }}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="voice-close-btn"
            onClick={onClose}
            title="Exit voice mode"
            aria-label="Exit voice mode"
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#94a3b8",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Central Voice Orb & Dynamic Visualizer */}
        <div className="voice-orb-section">
          <div
            className={`voice-orb-wrapper orb-state-${status}`}
            onClick={status === "speaking" ? handleInterrupt : undefined}
            title={status === "speaking" ? "Click orb to interrupt" : "Voice Agent Active"}
            style={{ cursor: status === "speaking" ? "pointer" : "default" }}
          >
            {/* Pulsing Ripple Rings */}
            <div className="orb-ring ring-1" />
            <div className="orb-ring ring-2" />
            <div className="orb-ring ring-3" />

            {/* Glowing 3D Orb Core */}
            <div className="voice-orb-core">
              <div className="orb-inner-light" />
              <div className="orb-surface-shimmer" />

              {/* Dynamic Equalizer Waves inside Orb */}
              {status === "speaking" && (
                <div className="orb-equalizer-bars">
                  <span className="eq-bar bar-1" />
                  <span className="eq-bar bar-2" />
                  <span className="eq-bar bar-3" />
                  <span className="eq-bar bar-4" />
                </div>
              )}

              {status === "thinking" && (
                <div className="orb-thinking-spinner" />
              )}

              {status === "listening" && (
                <div className="orb-listening-mic-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
              )}

              {status === "muted" && (
                <div className="orb-muted-icon" style={{ color: "#ef4444" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Dynamic Status Pill */}
          <div className="voice-status-pill">
            {status === "listening" && (
              <span className="status-listening-text">Listening in any language...</span>
            )}
            {status === "thinking" && (
              <span className="status-thinking-text">Thinking & translating...</span>
            )}
            {status === "speaking" && (
              <span className="status-speaking-text">Speaking in your language (Tap orb to interrupt)</span>
            )}
            {status === "muted" && (
              <span className="status-muted-text">Microphone Muted</span>
            )}
            {status === "idle" && (
              <span className="status-idle-text">Ready</span>
            )}
          </div>
        </div>

        {/* Live Multilingual Transcripts Box */}
        <div
          className="voice-transcript-container"
          style={{
            maxWidth: "600px",
            width: "90%",
            margin: "24px auto 16px auto",
            minHeight: "80px",
            background: "rgba(15, 23, 42, 0.65)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            padding: "16px 20px",
            backdropFilter: "blur(12px)",
            textAlign: "center",
          }}
        >
          {userTranscript && (
            <p style={{ color: "#38bdf8", fontSize: "15px", fontWeight: "500", margin: "0 0 8px 0" }}>
              <span style={{ opacity: 0.6, fontSize: "12px", display: "block", textTransform: "uppercase", letterSpacing: "0.05em" }}>You spoke:</span>
              "{userTranscript}"
            </p>
          )}

          {aiTranscript && status !== "idle" && (
            <p style={{ color: "#f1f5f9", fontSize: "14px", lineHeight: "1.5", margin: 0, opacity: 0.9 }}>
              {aiTranscript}
            </p>
          )}

          {!userTranscript && !aiTranscript && (
            <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>
              Speak naturally in any language (English, Tamil, Hindi, Spanish, French, etc.)
            </p>
          )}
        </div>

        {/* Bottom Floating Control Bar */}
        <div
          className="voice-bottom-controls"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "16px",
            padding: "16px 0 24px 0",
          }}
        >
          <button
            type="button"
            onClick={toggleMute}
            className={`voice-action-btn ${isMuted ? "btn-muted" : ""}`}
            style={{
              background: isMuted ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.1)",
              border: `1px solid ${isMuted ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.15)"}`,
              color: isMuted ? "#ef4444" : "#f8fafc",
              padding: "10px 18px",
              borderRadius: "24px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.2s ease",
            }}
          >
            {isMuted ? "Unmute Mic" : "Mute Mic"}
          </button>

          {status === "speaking" && (
            <button
              type="button"
              onClick={handleInterrupt}
              style={{
                background: "rgba(245, 158, 11, 0.2)",
                border: "1px solid rgba(245, 158, 11, 0.4)",
                color: "#fbbf24",
                padding: "10px 18px",
                borderRadius: "24px",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              Interrupt & Speak
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#94a3b8",
              padding: "10px 18px",
              borderRadius: "24px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            End Voice Call
          </button>
        </div>
      </div>
    </div>
  );
}
