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
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [speechRate, setSpeechRate] = useState(1.05);

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isListeningRef = useRef(false);
  const statusRef = useRef(status);
  const isMutedRef = useRef(isMuted);

  statusRef.current = status;
  isMutedRef.current = isMuted;

  // Load browser voices on mount
  useEffect(() => {
    const loadVoices = () => {
      const v = getAvailableVoices();
      if (v.length > 0 && !selectedVoiceURI) {
        const pref = v.find(
          (item) =>
            item.name.toLowerCase().includes("natural") ||
            item.name.toLowerCase().includes("neural") ||
            item.name.toLowerCase().includes("google")
        ) || v[0];
        if (pref) setSelectedVoiceURI(pref.voiceURI);
      }
    };

    loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoiceURI]);

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
      rec.lang = navigator.language || "en-US";

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

    let accumulatedText = "";

    try {
      await onSendMessage(
        promptText,
        {
          onDelta: (delta) => {
            accumulatedText += delta;
          },
          onDone: () => {
            // Once full response has arrived, speak it aloud in the detected language
            setStatus("speaking");
            const cleanText = cleanTextForSpeech(accumulatedText);
            
            // Detect language of the AI's response to select the matching native voice
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
            setTimeout(() => {
              if (!isMutedRef.current) startListening();
            }, 2000);
          },
        }
      );
    } catch (e) {
      setStatus("idle");
    }
  };

  // Interrupt AI speaking
  const handleOrbClick = () => {
    if (status === "speaking") {
      stopSpeech();
      setUserTranscript("");
      setAiTranscript("");
      if (!isMuted) {
        startListening();
      }
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
        {/* Top Close Button Only */}
        <div className="voice-modal-header" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", width: "100%", padding: "20px 24px" }}>
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
              width: "40px",
              height: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.15s ease",
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
            onClick={handleOrbClick}
            title={status === "speaking" ? "Tap orb to interrupt" : "Voice Agent Active"}
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
        </div>
      </div>
    </div>
  );
}
