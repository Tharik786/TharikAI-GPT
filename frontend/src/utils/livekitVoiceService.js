import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalAudioTrack,
  ConnectionState,
} from "livekit-client";

export class LiveKitVoiceService {
  constructor() {
    this.room = null;
    this.localAudioTrack = null;
    this.remoteAudioElement = null;
    this.isMuted = false;
    this.status = "idle"; // 'idle' | 'connecting' | 'listening' | 'user_speaking' | 'ai_speaking' | 'reconnecting' | 'disconnected' | 'error'
    this.listeners = {
      statusChange: [],
      transcript: [],
      error: [],
      audioLevels: [],
    };
    this.agentParticipant = null;
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in livekit listener for event '${event}':`, e);
        }
      });
    }
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.emit("statusChange", newStatus);
    }
  }

  /**
   * Connect to LiveKit Room using backend session info
   */
  async connect({ serverUrl, token }) {
    try {
      this.setStatus("connecting");

      // Clean up previous room if any
      if (this.room) {
        await this.disconnect();
      }

      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Setup audio output element for playback
      if (!this.remoteAudioElement && typeof document !== "undefined") {
        this.remoteAudioElement = document.createElement("audio");
        this.remoteAudioElement.autoplay = true;
        this.remoteAudioElement.style.display = "none";
        document.body.appendChild(this.remoteAudioElement);
      }

      // Room lifecycle event listeners
      this.room.on(RoomEvent.Connected, () => {
        this.setStatus("listening");
      });

      this.room.on(RoomEvent.Reconnecting, () => {
        this.setStatus("reconnecting");
      });

      this.room.on(RoomEvent.Reconnected, () => {
        this.setStatus("listening");
      });

      this.room.on(RoomEvent.Disconnected, (reason) => {
        this.setStatus("disconnected");
      });

      // Handle Remote Tracks (AI Agent Voice output)
      this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this.agentParticipant = participant;
          if (this.remoteAudioElement) {
            track.attach(this.remoteAudioElement);
          }
        }
      });

      this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && this.remoteAudioElement) {
          track.detach(this.remoteAudioElement);
        }
      });

      // Active Speaker detection (VAD / Turn detection / Interruption)
      this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (this.status === "connecting" || this.status === "disconnected") return;

        const isLocalSpeaking = speakers.some((s) => s.isLocal);
        const isAgentSpeaking = speakers.some((s) => !s.isLocal);

        if (this.isMuted) {
          if (isAgentSpeaking) {
            this.setStatus("ai_speaking");
          } else {
            this.setStatus("muted");
          }
          return;
        }

        if (isLocalSpeaking) {
          // User barge-in: User is speaking
          this.setStatus("user_speaking");
        } else if (isAgentSpeaking) {
          // AI is speaking
          this.setStatus("ai_speaking");
        } else {
          // Room is quiet, waiting for speech
          this.setStatus("listening");
        }
      });

      // Data Channel message handler (e.g., Live Transcripts from Agent)
      this.room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
          if (data && (data.text || data.transcript)) {
            const text = data.text || data.transcript;
            const role = data.role || (participant?.isLocal ? "user" : "assistant");
            this.emit("transcript", {
              role,
              text,
              isFinal: data.is_final ?? true,
            });
          }
        } catch {
          // Non-JSON or binary data packet
        }
      });

      // Connect to LiveKit SFU server
      await this.room.connect(serverUrl, token);

      // Publish local microphone track
      await this.enableMicrophone(true);

      return true;
    } catch (err) {
      console.error("LiveKit connection error:", err);
      this.setStatus("error");
      this.emit("error", err.message || "Failed to establish LiveKit voice connection.");
      throw err;
    }
  }

  /**
   * Enables or disables microphone audio publishing
   */
  async enableMicrophone(enabled = true) {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;

    try {
      if (enabled) {
        await this.room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        this.isMuted = false;
        this.setStatus("listening");
      } else {
        await this.room.localParticipant.setMicrophoneEnabled(false);
        this.isMuted = true;
        this.setStatus("muted");
      }
    } catch (err) {
      console.error("Error setting microphone state:", err);
      if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
        this.emit("error", "Microphone permission is required for voice chat.");
      } else {
        this.emit("error", err.message || "Microphone initialization error.");
      }
    }
  }

  /**
   * Toggles microphone mute state
   */
  async toggleMute() {
    await this.enableMicrophone(this.isMuted);
    return this.isMuted;
  }

  /**
   * Cleanly disconnects and resets all audio tracks and state
   */
  async disconnect() {
    try {
      if (this.room) {
        try {
          await this.room.disconnect(true);
        } catch {}
        this.room = null;
      }

      if (this.remoteAudioElement) {
        try {
          this.remoteAudioElement.pause();
          this.remoteAudioElement.srcObject = null;
          if (this.remoteAudioElement.parentNode) {
            this.remoteAudioElement.parentNode.removeChild(this.remoteAudioElement);
          }
        } catch {}
        this.remoteAudioElement = null;
      }

      this.isMuted = false;
      this.agentParticipant = null;
      this.setStatus("disconnected");
    } catch (e) {
      console.warn("Disconnect cleanup notice:", e);
    }
  }
}

export const livekitVoice = new LiveKitVoiceService();
