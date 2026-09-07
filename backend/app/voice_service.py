import os
import time
import uuid
import json
import hmac
import hashlib
import base64
from typing import Dict, Any, Optional

# LiveKit configuration from environment
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "").strip()


def _base64url_encode(data: bytes) -> str:
    """Base64 URL-safe encoding without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _generate_jwt_hs256(payload: dict, secret: str) -> str:
    """Zero-dependency HS256 JWT generator."""
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _base64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def get_livekit_config() -> Dict[str, Any]:
    """
    Returns current LiveKit configuration status without leaking secret keys.
    """
    url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    is_configured = bool(url and api_key and api_secret)

    return {
        "configured": is_configured,
        "server_url": url,
        "has_api_key": bool(api_key),
        "has_api_secret": bool(api_secret),
        "has_openai_key": bool(openai_key),
    }


def create_livekit_token(
    room_name: Optional[str] = None,
    identity: Optional[str] = None,
    name: Optional[str] = None,
    ttl_seconds: int = 3600,
) -> Dict[str, str]:
    """
    Generates a secure, short-lived LiveKit participant access token for WebRTC voice communication.
    Uses official livekit.api if installed, or built-in standard LiveKit-compatible JWT payload.
    """
    server_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()

    if not server_url:
        raise ValueError("LIVEKIT_URL is not configured on the backend.")
    if not api_key or not api_secret:
        raise ValueError("LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing on the backend.")

    # Format room name and identity
    room = room_name.strip() if room_name and room_name.strip() else f"tharikai-voice-{uuid.uuid4().hex[:12]}"
    user_identity = identity.strip() if identity and identity.strip() else f"user-{uuid.uuid4().hex[:8]}"
    display_name = name.strip() if name and name.strip() else "TharikAI User"

    # 1. Try official livekit-api package first if installed
    try:
        from livekit import api  # type: ignore
        token_obj = (
            api.AccessToken(api_key, api_secret)
            .with_identity(user_identity)
            .with_name(display_name)
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room,
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=True,
                )
            )
            .with_ttl(ttl_seconds)
        )
        token_str = token_obj.to_jwt()
    except Exception:
        # 2. Built-in zero-dependency LiveKit HS256 JWT generation
        now = int(time.time())
        payload = {
            "iss": api_key,
            "sub": user_identity,
            "name": display_name,
            "nbf": now - 5,
            "exp": now + ttl_seconds,
            "video": {
                "room": room,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        }
        token_str = _generate_jwt_hs256(payload, api_secret)

    return {
        "roomName": room,
        "token": token_str,
        "serverUrl": server_url,
        "participantIdentity": user_identity,
        "participantName": display_name,
    }
