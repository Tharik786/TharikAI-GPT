import os
import ssl
import logging
from pathlib import Path
# pyrefly: ignore [missing-import]
import pg8000.native
from dotenv import load_dotenv

logger = logging.getLogger("tharikai.db")

backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")
load_dotenv()

import urllib.parse

def get_db_params():
    # Primary: Read DATABASE_URL or SUPABASE_DB_URL from environment variables
    database_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if database_url and database_url.strip():
        url = database_url.strip().strip("'\"")
        # Standardize postgres:// to postgresql://
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        parsed = urllib.parse.urlparse(url)
        if not parsed.hostname:
            raise ValueError("DATABASE_URL is missing host or hostname.")

        return {
            "user": urllib.parse.unquote(parsed.username or ""),
            "password": urllib.parse.unquote(parsed.password or ""),
            "host": parsed.hostname,
            "port": int(parsed.port or 5432),
            "database": parsed.path.lstrip("/").split("?")[0] or "postgres",
            "sslmode": urllib.parse.parse_qs(parsed.query).get("sslmode", [""])[0].lower(),
        }

    # Secondary fallback: Individual Supabase / PostgreSQL environment variables
    host = os.getenv("SUPABASE_DB_HOST") or os.getenv("POSTGRES_HOST")
    if host and host.strip():
        return {
            "user": os.getenv("SUPABASE_DB_USER") or os.getenv("POSTGRES_USER", "postgres"),
            "password": os.getenv("SUPABASE_DB_PASSWORD") or os.getenv("POSTGRES_PASSWORD", ""),
            "host": host.strip(),
            "port": int(os.getenv("SUPABASE_DB_PORT") or os.getenv("POSTGRES_PORT", "5432")),
            "database": os.getenv("SUPABASE_DB_NAME") or os.getenv("POSTGRES_DB", "postgres"),
            "sslmode": "",
        }

    # If neither DATABASE_URL nor host is configured, do NOT fallback to localhost:5432
    raise ValueError(
        "Database configuration error: DATABASE_URL environment variable is not set. "
        "Please add DATABASE_URL in your Render Web Service Environment settings."
    )


def get_db_connection():
    params = get_db_params()

    # Cloud hosted databases (Supabase, Neon, Railway, Render) require SSL
    ssl_enabled = os.getenv("DB_SSL", "true").lower() not in ("0", "false", "no", "off")
    ssl_not_disabled = params.get("sslmode") != "disable"
    context = None
    if ssl_enabled and ssl_not_disabled and params["host"] not in ("localhost", "127.0.0.1"):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    return pg8000.native.Connection(
        user=params["user"],
        host=params["host"],
        port=params["port"],
        database=params["database"],
        password=params["password"],
        ssl_context=context,
        timeout=15,
    )


def init_db():
    """Initializes tables in Supabase Postgres if they do not exist."""
    try:
        con = get_db_connection()
        schema_sql = """
        CREATE TABLE IF NOT EXISTS public.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.conversations (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'New chat',
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS public.messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS public.memories (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_user_email ON public.conversations(user_email);
        CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON public.messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_memories_user_email ON public.memories(user_email);
        """
        con.run(schema_sql)
        con.close()
        logger.info("Supabase database tables initialized successfully.")
        return True
    except Exception as e:
        logger.error(f"Error initializing Supabase database: {e}")
        return False


def get_user(email: str):
    email = email.strip().lower()
    con = get_db_connection()
    try:
        rows = con.run("SELECT id, email, name, password_hash, created_at FROM public.users WHERE LOWER(email) = :email LIMIT 1", email=email)
        if not rows:
            return None
        r = rows[0]
        return {
            "id": str(r[0]),
            "email": r[1],
            "name": r[2],
            "password_hash": r[3],
            "created_at": str(r[4]),
        }
    finally:
        con.close()


def save_user(email: str, name: str, password_hash: str):
    email = email.strip().lower()
    con = get_db_connection()
    try:
        con.run(
            """
            INSERT INTO public.users (email, name, password_hash)
            VALUES (:email, :name, :password_hash)
            ON CONFLICT (email) DO UPDATE 
            SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
            """,
            email=email,
            name=name,
            password_hash=password_hash,
        )
        return get_user(email)
    finally:
        con.close()


def list_conversations(email: str):
    email = email.strip().lower()
    con = get_db_connection()
    try:
        conv_rows = con.run(
            """
            SELECT id, title, created_at, updated_at
            FROM public.conversations
            WHERE LOWER(user_email) = :email
            ORDER BY updated_at DESC
            """,
            email=email,
        )

        conversations = []
        for row in conv_rows:
            conv_id = row[0]
            msg_rows = con.run(
                """
                SELECT id, role, content, created_at
                FROM public.messages
                WHERE conversation_id = :conv_id
                ORDER BY created_at ASC
                """,
                conv_id=conv_id,
            )
            messages = [
                {"id": m[0], "role": m[1], "content": m[2], "createdAt": m[3]}
                for m in msg_rows
            ]

            conversations.append({
                "id": conv_id,
                "title": row[1],
                "createdAt": row[2],
                "updatedAt": row[3],
                "messages": messages,
            })

        return conversations
    finally:
        con.close()


def save_conversation(conv_id: str, email: str, title: str, created_at: int, updated_at: int):
    email = email.strip().lower()
    con = get_db_connection()
    try:
        con.run(
            """
            INSERT INTO public.conversations (id, user_email, title, created_at, updated_at)
            VALUES (:id, :email, :title, :created_at, :updated_at)
            ON CONFLICT (id) DO UPDATE
            SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at
            """,
            id=conv_id,
            email=email,
            title=title,
            created_at=created_at,
            updated_at=updated_at,
        )
    finally:
        con.close()


def set_messages(conv_id: str, messages: list, updated_at: int):
    con = get_db_connection()
    try:
        # Update updated_at of conversation
        con.run(
            "UPDATE public.conversations SET updated_at = :updated_at WHERE id = :id",
            id=conv_id,
            updated_at=updated_at,
        )
        # Delete existing messages and insert new
        con.run("DELETE FROM public.messages WHERE conversation_id = :id", id=conv_id)
        for idx, m in enumerate(messages):
            msg_id = m.get("id") or f"{conv_id}-{idx}"
            role = m.get("role", "user")
            content = m.get("content", "")
            created_at = m.get("createdAt") or (updated_at + idx)
            con.run(
                """
                INSERT INTO public.messages (id, conversation_id, role, content, created_at)
                VALUES (:id, :conv_id, :role, :content, :created_at)
                """,
                id=msg_id,
                conv_id=conv_id,
                role=role,
                content=content,
                created_at=created_at,
            )
    finally:
        con.close()


def delete_conversation(conv_id: str):
    con = get_db_connection()
    try:
        con.run("DELETE FROM public.conversations WHERE id = :id", id=conv_id)
    finally:
        con.close()


def get_user_memories(email: str) -> list[dict]:
    email = email.strip().lower()
    con = get_db_connection()
    try:
        rows = con.run(
            """
            SELECT id, content, created_at
            FROM public.memories
            WHERE LOWER(user_email) = :email
            ORDER BY created_at DESC
            """,
            email=email,
        )
        return [
            {"id": r[0], "content": r[1], "createdAt": r[2]}
            for r in rows
        ]
    except Exception as e:
        logger.error(f"Error fetching memories: {e}")
        return []
    finally:
        con.close()


def add_user_memory(email: str, content: str, memory_id: str | None = None, created_at: int | None = None) -> dict:
    import time
    import uuid
    email = email.strip().lower()
    mem_id = memory_id or f"mem_{uuid.uuid4().hex[:12]}"
    now_ts = created_at or int(time.time() * 1000)
    con = get_db_connection()
    try:
        con.run(
            """
            INSERT INTO public.memories (id, user_email, content, created_at)
            VALUES (:id, :email, :content, :created_at)
            ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content
            """,
            id=mem_id,
            email=email,
            content=content.strip(),
            created_at=now_ts,
        )
        return {"id": mem_id, "user_email": email, "content": content.strip(), "createdAt": now_ts}
    finally:
        con.close()


def delete_user_memory(memory_id: str):
    con = get_db_connection()
    try:
        con.run("DELETE FROM public.memories WHERE id = :id", id=memory_id)
        return True
    finally:
        con.close()
