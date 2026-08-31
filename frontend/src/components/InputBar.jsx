import React, { useRef, useState, useEffect } from "react";

export default function InputBar({ value, onChange, onSend, disabled }) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  const [attachments, setAttachments] = useState([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Web Speech API initialization for voice-to-text
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let prefixText = "";

    recognition.onstart = () => {
      setIsListening(true);
      const current = valueRef.current || "";
      prefixText = current ? (current.endsWith(" ") ? current : current + " ") : "";
    };

    recognition.onresult = (event) => {
      let finalSpeech = "";
      let interimSpeech = "";

      for (let i = 0; i < event.results.length; ++i) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalSpeech += chunk + " ";
        } else {
          interimSpeech += chunk;
        }
      }

      const updated = (prefixText + finalSpeech + interimSpeech).trimStart();
      onChange(updated);

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 200) + "px";
      }
    };

    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        alert("Microphone permission was denied. Please allow microphone access in your browser settings.");
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, [onChange]);

  const toggleListening = () => {
    if (!voiceSupported) {
      alert("Voice-to-text is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.warn("Speech recognition start failed:", err);
      }
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
    }
    if (attachMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachMenuOpen]);

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

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      if (isImage) {
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            { name: file.name, size: file.size, type: file.type, isImage: true, dataUrl: reader.result },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            { name: file.name, size: file.size, type: file.type, isImage: false, textContent: reader.result },
          ]);
        };
        reader.readAsText(file);
      }
    });

    e.target.value = "";
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = () => {
    if ((!value.trim() && attachments.length === 0) || disabled) return;

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setIsListening(false);
    }

    let fullPrompt = value.trim();

    // If text files are attached, append their content to the prompt
    attachments.forEach((att) => {
      if (att.isImage) {
        fullPrompt += `\n\n[Attached image: ${att.name}]`;
      } else if (att.textContent) {
        fullPrompt += `\n\n--- Attached File: ${att.name} ---\n${att.textContent}\n--- End of File ---`;
      }
    });

    onSend(fullPrompt);
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="input-bar">
      <div className="input-bar-inner">
        {/* Attachment menu popup */}
        {attachMenuOpen && (
          <div className="attach-popup-menu" ref={menuRef}>
            <button className="attach-menu-item" onClick={handleFileClick}>
              <div className="attach-item-icon">
                <PaperclipIcon />
              </div>
              <div className="attach-item-texts">
                <span className="attach-item-title">Add photos & files</span>
                <span className="attach-item-sub">Upload from computer</span>
              </div>
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.csv,.py,.js,.jsx,.ts,.tsx,.html,.css"
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

        <div className="input-field-wrapper">


          {/* Selected attachment preview chips */}
          {attachments.length > 0 && (
            <div className="attachment-chips-row">
              {attachments.map((att, idx) => (
                <div key={idx} className="attachment-chip">
                  {att.isImage ? (
                    <img src={att.dataUrl} alt={att.name} className="chip-img-preview" />
                  ) : (
                    <FileIcon />
                  )}
                  <span className="chip-filename" title={att.name}>{att.name}</span>
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
            placeholder={isListening ? "Listening..." : "Message TharikAI..."}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Voice-to-text Microphone Button */}
        <button
          type="button"
          className={`voice-btn ${isListening ? "listening" : ""}`}
          onClick={toggleListening}
          aria-label={isListening ? "Stop voice recording" : "Voice to text"}
          title={isListening ? "Stop voice recording" : "Voice to text (Dictate)"}
        >
          {isListening ? <MicOffIcon /> : <MicIcon />}
        </button>

        {/* Send message button */}
        <button
          className="send-btn"
          disabled={(!value.trim() && attachments.length === 0) || disabled}
          onClick={submit}
          aria-label="Send message"
          title="Send message"
        >
          <SendIcon />
        </button>
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 8l12-6-4.5 12-2-5-5.5-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
