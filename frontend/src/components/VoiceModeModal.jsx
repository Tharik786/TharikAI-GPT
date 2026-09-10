import React, { useState, useEffect, useRef, useCallback } from "react";
import { requestVoiceSession } from "../api";
import { livekitVoice } from "../utils/livekitVoiceService";
import {
  speakMessage,
  stopSpeech,
  cleanTextForSpeech,
  cleanRecognizedSpeech,
  getAvailableVoices,
  detectTextLanguage,
  getBestVoiceForLanguage,
} from "../utils/speechService";

export const VOICE_LANGUAGES = [
  { code: "auto", name: "Auto", flag: "🌐", tag: (typeof navigator !== "undefined" && navigator.languages && navigator.languages[0]) || (typeof navigator !== "undefined" && navigator.language) || "en-US" },
  { code: "ta", name: "தமிழ்", flag: "🇮🇳", tag: "ta-IN" },
  { code: "ml", name: "മലയാളം", flag: "🇮🇳", tag: "ml-IN" },
  { code: "en", name: "English", flag: "🇺🇸", tag: "en-US" },
  { code: "hi", name: "हिन्दी", flag: "🇮🇳", tag: "hi-IN" },
  { code: "te", name: "తెలుగు", flag: "🇮🇳", tag: "te-IN" },
];

export default function VoiceModeModal({
  isOpen,
  onClose,
  onSendMessage,
  activeConversationTitle = "Live Voice Session",
  user = null,
}) {
  const [spokenLang, setSpokenLang] = useState(() => {
    return (typeof localStorage !== "undefined" && localStorage.getItem("tharikai_voice_lang")) || "auto";
  });
  const [mode, setMode] = useState("livekit"); // 'livekit' | 'browser_fallback'
  const [status, setStatus] = useState("connecting"); // 'connecting' | 'listening' | 'user_speaking' | 'ai_speaking' | 'muted' | 'reconnecting' | 'disconnected' | 'error'
  const [errorMessage, setErrorMessage] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [callDuration, setCallDuration] = useState(0);
  const [showTranscripts, setShowTranscripts] = useState(false);

  const durationTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isListeningFallbackRef = useRef(false);
  const latestSpeechTextRef = useRef("");

  // Format duration mm:ss
  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // -------------------------------------------------------------
  // LiveKit WebRTC Voice Session Lifecycle
  // -------------------------------------------------------------
  const initLiveKitVoice = useCallback(async () => {
    try {
      setStatus("connecting");
      setErrorMessage("");

      // 1. Request microphone permission early
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Stop initial test stream so LiveKit can bind it cleanly
          stream.getTracks().forEach((t) => t.stop());
        } catch (permErr) {
          if (permErr.name === "NotAllowedError" || permErr.name === "PermissionDeniedError") {
            setStatus("error");
            setErrorMessage("Microphone permission is required for voice chat. Please allow mic access.");
            return;
          }
        }
      }

      // 2. Request LiveKit token from backend
      const session = await requestVoiceSession({
        email: user?.email,
        name: user?.name,
      });

      if (!session || !session.token || !session.serverUrl) {
        throw new Error("Invalid session data returned from server.");
      }

      setMode("livekit");

      // 3. Connect to LiveKit Room
      await livekitVoice.connect({
        serverUrl: session.serverUrl,
        token: session.token,
      });
    } catch (err) {
      console.warn("LiveKit connection notice, switching to responsive fallback mode:", err);
      // If LiveKit is not configured or fails, fallback to local voice engine
      startFallbackVoiceMode();
    }
  }, [user]);

  // Subscribe to LiveKit events
  useEffect(() => {
    const unsubStatus = livekitVoice.on("statusChange", (newStatus) => {
      setStatus(newStatus);
      if (newStatus === "muted") setIsMuted(true);
      else if (newStatus === "listening" || newStatus === "user_speaking") setIsMuted(false);
    });

    const unsubTranscript = livekitVoice.on("transcript", ({ role, text }) => {
      if (!text || !text.trim()) return;
      setTranscripts((prev) => [
        ...prev,
        { id: `t-${Date.now()}-${Math.random()}`, role, text, timestamp: new Date() },
      ]);
    });

    const unsubError = livekitVoice.on("error", (msg) => {
      setErrorMessage(msg);
      setStatus("error");
    });

    return () => {
      unsubStatus();
      unsubTranscript();
      unsubError();
    };
  }, []);

  // -------------------------------------------------------------
  // Fallback Voice Recognition (When LiveKit Server is not active)
  // -------------------------------------------------------------
  const startFallbackVoiceMode = () => {
    setMode("browser_fallback");
    setStatus("listening");
    startFallbackSpeechRec();
  };

  const startFallbackSpeechRec = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setStatus("error");
      setErrorMessage("Your browser does not support realtime speech recognition.");
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
      
      const targetCode = overrideLang || spokenLang;
      const langObj = VOICE_LANGUAGES.find((l) => l.code === targetCode) || VOICE_LANGUAGES[0];
      rec.lang = langObj.tag;

      rec.onstart = () => {
        isListeningFallbackRef.current = true;
        setStatus("listening");
      };

      rec.onresult = (event) => {
        let finalStr = "";
        let interimStr = "";

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (!res || !res[0]) continue;
          const chunk = (res[0].transcript || "").trim();
          if (!chunk) continue;

          if (res.isFinal) {
            finalStr = finalStr ? `${finalStr} ${chunk}` : chunk;
          } else {
            interimStr = interimStr ? `${interimStr} ${chunk}` : chunk;
          }
        }

        let rawCombined = finalStr;
        if (interimStr) {
          rawCombined = finalStr ? `${finalStr} ${interimStr}` : interimStr;
        }

        const cleanedText = cleanRecognizedSpeech(rawCombined);

        if (cleanedText && cleanedText.length >= 2) {
          setStatus("user_speaking");
          latestSpeechTextRef.current = cleanedText;

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            const textToSend = latestSpeechTextRef.current;
            if (isListeningFallbackRef.current && textToSend && textToSend.length >= 2) {
              handleFallbackVoiceTurn(textToSend);
            }
          }, 1200);
        }
      };

      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed") {
          setIsMuted(true);
          setStatus("muted");
          setErrorMessage("Microphone access denied.");
        }
      };

      rec.onend = () => {
        isListeningFallbackRef.current = false;
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.warn("Fallback speech rec error:", err);
    }
  }, []);

  const handleFallbackVoiceTurn = async (promptText) => {
    const cleanPrompt = cleanRecognizedSpeech(promptText);
    if (!cleanPrompt || cleanPrompt.length < 2) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    latestSpeechTextRef.current = "";

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    isListeningFallbackRef.current = false;

    setStatus("ai_speaking");
    setTranscripts((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: promptText, timestamp: new Date() },
    ]);

    let accumulated = "";

    try {
      if (onSendMessage) {
        await onSendMessage(promptText, {
          onDelta: (delta) => {
            accumulated += delta;
          },
          onDone: () => {
            setTranscripts((prev) => [
              ...prev,
              { id: `ai-${Date.now()}`, role: "assistant", text: accumulated, timestamp: new Date() },
            ]);
            const cleanText = cleanTextForSpeech(accumulated);
            const detectedLang = detectTextLanguage(cleanText);
            const nativeVoice = getBestVoiceForLanguage(detectedLang);

            speakMessage(`voice-mode-${Date.now()}`, cleanText, {
              voice: nativeVoice,
              lang: detectedLang,
              rate: 1.05,
              onEnd: () => {
                if (!isMuted) {
                  setStatus("listening");
                  setTimeout(() => startFallbackSpeechRec(), 300);
                }
              },
            });
          },
          onError: (err) => {
            setErrorMessage(err);
            setStatus("error");
          },
        });
      }
    } catch (e) {
      console.error("Voice turn error:", e);
      setStatus("listening");
      setTimeout(() => startFallbackSpeechRec(), 400);
    }
  };

  const handleLanguageChange = (code) => {
    setSpokenLang(code);
    try {
      localStorage.setItem("tharikai_voice_lang", code);
    } catch {}
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    if (!isMuted && status !== "ai_speaking") {
      setTimeout(() => {
        startFallbackSpeechRec(code);
      }, 100);
    }
  };

  // -------------------------------------------------------------
  // Controls (Mute, End Call, Barge-In)
  // -------------------------------------------------------------
  const handleToggleMute = async () => {
    if (mode === "livekit") {
      const newMuted = await livekitVoice.toggleMute();
      setIsMuted(newMuted);
    } else {
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      if (nextMuted) {
        setStatus("muted");
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
        }
      } else {
        setStatus("listening");
        startFallbackSpeechRec();
      }
    }
  };

  const handleEndCall = () => {
    cleanupSession();
    onClose();
  };

  const handleOrbInterrupt = () => {
    if (status === "ai_speaking") {
      stopSpeech();
      if (mode === "livekit") {
        livekitVoice.enableMicrophone(true);
      } else {
        setStatus("listening");
        startFallbackSpeechRec();
      }
    }
  };

  const cleanupSession = () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }
    stopSpeech();
    livekitVoice.disconnect();
    setStatus("disconnected");
  };

  // -------------------------------------------------------------
  // Modal Open / Close Lifecycle
  // -------------------------------------------------------------
  useEffect(() => {
    if (isOpen) {
      setTranscripts([]);
      setCallDuration(0);
      setErrorMessage("");

      durationTimerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);

      initLiveKitVoice();
    } else {
      cleanupSession();
    }

    return () => {
      cleanupSession();
    };
  }, [isOpen, initLiveKitVoice]);

  if (!isOpen) return null;

  // Status Labels & Glow
  const getStatusDisplay = () => {
    switch (status) {
      case "connecting":
        return { text: "Connecting...", dot: "#eab308" };
      case "listening":
        return { text: "Listening...", dot: "#10b981" };
      case "user_speaking":
        return { text: "You are speaking...", dot: "#3b82f6" };
      case "ai_speaking":
        return { text: "TharikAI is speaking...", dot: "#8b5cf6" };
      case "muted":
        return { text: "Microphone Muted", dot: "#ef4444" };
      case "reconnecting":
        return { text: "Reconnecting...", dot: "#f97316" };
      case "error":
        return { text: "Connection Error", dot: "#ef4444" };
      default:
        return { text: "Connected", dot: "#10b981" };
    }
  };

  const statusInfo = getStatusDisplay();
  const latestTranscript = transcripts[transcripts.length - 1];

  return (
    <div className="voice-modal-overlay" role="dialog" aria-modal="true">
      {/* Dynamic Ambient Background Glow */}
      <div className={`voice-ambient-glow glow-${status}`} />

      <div className="voice-modal-container">
        {/* Top Header Controls */}
        <div className="voice-modal-top-bar">
          <div className="voice-call-info">
            <span className="voice-status-pill">
              <span className="voice-status-dot" style={{ backgroundColor: statusInfo.dot }} />
              <span className="voice-status-text">{statusInfo.text}</span>
            </span>
            <span className="voice-duration-counter">{formatDuration(callDuration)}</span>
          </div>

          <div className="voice-top-actions">
            {/* Live Transcript Toggle */}
            <button
              type="button"
              className={`voice-action-icon-btn ${showTranscripts ? "active" : ""}`}
              onClick={() => setShowTranscripts(!showTranscripts)}
              title={showTranscripts ? "Hide Transcript" : "Show Transcript"}
              aria-label="Toggle transcript"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            {/* Close / End Voice Mode */}
            <button
              type="button"
              className="voice-action-icon-btn voice-exit-btn"
              onClick={handleEndCall}
              title="End Voice Mode"
              aria-label="Exit voice mode"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Multilingual Voice Language Bar */}
        <div className="voice-lang-bar" role="radiogroup" aria-label="Spoken language">
          {VOICE_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              className={`voice-lang-pill ${spokenLang === lang.code ? "active" : ""}`}
              onClick={() => handleLanguageChange(lang.code)}
              title={`Speak in ${lang.name}`}
            >
              <span className="lang-pill-flag">{lang.flag}</span>
              <span className="lang-pill-name">{lang.name}</span>
            </button>
          ))}
        </div>

        {/* Center Section: Animated Visualizer Orb */}
        <div className="voice-orb-section">
          <div
            className={`voice-orb-wrapper orb-state-${status}`}
            onClick={handleOrbInterrupt}
            title={status === "ai_speaking" ? "Tap orb to interrupt AI" : "Realtime Voice Agent"}
          >
            {/* Pulsing Ripple Rings */}
            <div className="orb-ring ring-1" />
            <div className="orb-ring ring-2" />
            <div className="orb-ring ring-3" />

            {/* Glowing 3D Orb Core */}
            <div className="voice-orb-core">
              <div className="orb-inner-light" />
              <div className="orb-surface-shimmer" />

              {/* Dynamic Sound Equalizer Waves */}
              {status === "ai_speaking" && (
                <div className="orb-equalizer-bars">
                  <span className="eq-bar bar-1" />
                  <span className="eq-bar bar-2" />
                  <span className="eq-bar bar-3" />
                  <span className="eq-bar bar-4" />
                </div>
              )}

              {status === "user_speaking" && (
                <div className="orb-equalizer-bars user-wave">
                  <span className="eq-bar bar-user-1" />
                  <span className="eq-bar bar-user-2" />
                  <span className="eq-bar bar-user-3" />
                </div>
              )}

              {status === "connecting" && <div className="orb-thinking-spinner" />}

              {status === "listening" && (
                <div className="orb-listening-mic-icon">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
              )}

              {status === "muted" && (
                <div className="orb-muted-icon">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Assistant Title & Status Feedback */}
          <div className="voice-meta-header">
            <h2 className="voice-title">THARIK AI</h2>
            <p className="voice-subtitle">
              {status === "ai_speaking"
                ? "Speaking... (Tap orb to interrupt)"
                : status === "user_speaking"
                ? "Listening to your voice..."
                : status === "muted"
                ? "Microphone is muted"
                : "Realtime Voice-to-Voice Active"}
            </p>
          </div>

          {/* Subtitle / Live Floating Speech Bubble */}
          {!showTranscripts && latestTranscript && (
            <div className={`voice-live-bubble ${latestTranscript.role}`}>
              <span className="bubble-speaker-label">
                {latestTranscript.role === "user" ? "You" : "TharikAI"}
              </span>
              <p className="bubble-text">{latestTranscript.text}</p>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="voice-error-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Realtime Full Transcript Drawer */}
        {showTranscripts && (
          <div className="voice-transcript-drawer">
            <div className="transcript-drawer-header">
              <h3>Realtime Transcript</h3>
              <button
                type="button"
                className="transcript-close-btn"
                onClick={() => setShowTranscripts(false)}
              >
                ✕
              </button>
            </div>
            <div className="transcript-list">
              {transcripts.length === 0 ? (
                <div className="transcript-empty">Speak naturally to begin transcript...</div>
              ) : (
                transcripts.map((t) => (
                  <div key={t.id} className={`transcript-row ${t.role}`}>
                    <span className="transcript-sender">
                      {t.role === "user" ? "You" : "TharikAI"}
                    </span>
                    <p className="transcript-content">{t.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Bottom Call Controls Bar */}
        <div className="voice-bottom-controls">
          {/* Mute Toggle */}
          <button
            type="button"
            className={`voice-control-btn ${isMuted ? "muted" : "unmuted"}`}
            onClick={handleToggleMute}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                <span>Unmute</span>
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                <span>Mute</span>
              </>
            )}
          </button>

          {/* End Call Button */}
          <button
            type="button"
            className="voice-control-btn end-call-btn"
            onClick={handleEndCall}
            title="End Voice Conversation"
            aria-label="End voice conversation"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
}
