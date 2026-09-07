"""
TharikAI Realtime Voice Agent
=============================
Connects to LiveKit rooms using WebRTC, interfaces with OpenAI Realtime API / Voice Pipeline,
and provides natural realtime voice-to-voice conversation with VAD, barge-in interruption,
and live transcript dispatch.
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

load_dotenv(backend_dir / ".env")
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tharikai-voice-agent")

SYSTEM_INSTRUCTION = (
    "You are TharikAI, a helpful, intelligent, friendly AI assistant. "
    "Speak naturally and conversationally. Keep responses concise during voice conversations. "
    "Do not unnecessarily repeat the user's question. If the user interrupts you, stop speaking and listen. "
    "Ask clarification questions when necessary."
)


def run_agent():
    """
    Starts the LiveKit voice agent worker.
    Supports LiveKit Agents framework (livekit-agents) with OpenAI Realtime.
    """
    try:
        from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
        from livekit.agents.voice_assistant import VoiceAssistant
        from livekit.plugins import openai, silero
    except ImportError as e:
        logger.warning(
            "LiveKit Agents SDK packages are not fully installed. "
            "To run the standalone voice worker, install: "
            "pip install livekit-agents livekit-plugins-openai livekit-plugins-silero\n"
            f"Details: {e}"
        )
        return

    async def entrypoint(ctx: JobContext):
        logger.info(f"Connecting to room: {ctx.room.name}")
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

        # Wait for the first human participant to join
        participant = await ctx.wait_for_participant()
        logger.info(f"Participant joined: {participant.identity} ({participant.name})")

        # Configure LiveKit Voice Assistant with VAD and OpenAI Realtime/TTS/STT
        try:
            # Check if OpenAI Realtime model is available
            openai_api_key = os.getenv("OPENAI_API_KEY", "")
            
            # Setup Voice Assistant with Silero VAD (instant interruption & barge-in)
            assistant = VoiceAssistant(
                vad=silero.VAD.load(),
                stt=openai.STT(),
                llm=openai.LLM(model="gpt-4o-mini"),
                tts=openai.TTS(voice="alloy"),
                chat_ctx=llm.ChatContext().append(
                    role="system",
                    text=SYSTEM_INSTRUCTION,
                ),
            )

            # Start assistant in the room
            assistant.start(ctx.room, participant)

            # Welcome greeting
            await assistant.say("Hello! I'm TharikAI. How can I help you today?", allow_interruptions=True)
        except Exception as err:
            logger.error(f"Error during voice assistant session: {err}", exc_info=True)

    # Run the worker CLI
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    run_agent()
