from __future__ import annotations

import asyncio
import json
import os
import secrets
import sqlite3
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator

TOKEN = os.environ.get("RECEIVER_TOKEN", "")
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", "messages.db"))
MAX_MESSAGES = max(1, int(os.environ.get("MAX_MESSAGES", "50")))
DB_LOCK = threading.Lock()

class AlertFields(BaseModel):
    schema_version: Literal[1] = 1
    type: Literal["instant_move", "ma60_deviation"]
    symbol: str = Field(min_length=1, max_length=40)
    period: str = Field(min_length=1, max_length=20)
    direction: Literal["up", "down"]
    change_percent: float
    threshold_percent: float = Field(ge=0)
    triggered_at: datetime

    @field_validator("symbol", "period")
    @classmethod
    def trim_fields(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("value must not be blank")
        return trimmed


class MessageInput(BaseModel):
    id: str | None = Field(default=None, max_length=128)
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=32_768)
    level: Literal["info", "success", "warning", "error"] = "info"
    kind: Literal["alert", "scheduled"] = "alert"
    timestamp: datetime | None = None
    alert: AlertFields | None = None

    @field_validator("id", "title")
    @classmethod
    def trim_metadata(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("value must not be blank")
        return trimmed

    @field_validator("body")
    @classmethod
    def reject_blank_body(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body must not be blank")
        return value


def require_configured_token() -> None:
    if len(TOKEN) < 16:
        raise RuntimeError("RECEIVER_TOKEN must contain at least 16 characters")


def authorize(authorization: str | None) -> None:
    expected = f"Bearer {TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid token")


def connect_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DB_LOCK:
        connection = connect_database()
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    level TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'alert',
                    alert_json TEXT
                )
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(messages)")}
            if "kind" not in columns:
                connection.execute("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'alert'")
            if "alert_json" not in columns:
                connection.execute("ALTER TABLE messages ADD COLUMN alert_json TEXT")
            connection.execute(
                "UPDATE messages SET kind = 'scheduled' "
                "WHERE kind = 'alert' AND (title LIKE 'Quantum Ranking%' OR title LIKE '%轻量守护%')"
            )
            prune_messages(connection)
            connection.commit()
        finally:
            connection.close()


def prune_messages(connection: sqlite3.Connection) -> None:
    connection.execute(
        "DELETE FROM messages "
        "WHERE seq NOT IN ("
        "SELECT seq FROM ("
        "SELECT seq FROM messages WHERE kind = 'alert' ORDER BY seq DESC LIMIT ?"
        ")"
        ") AND seq NOT IN ("
        "SELECT seq FROM ("
        "SELECT seq FROM messages WHERE kind = 'scheduled' ORDER BY seq DESC LIMIT 1"
        ")"
        ")",
        (MAX_MESSAGES,),
    )


def store_message(message: MessageInput) -> dict:
    message_id = message.id or str(uuid.uuid4())
    message_time = message.timestamp or datetime.now(timezone.utc)
    if message_time.tzinfo is None:
        message_time = message_time.replace(tzinfo=timezone.utc)
    timestamp = message_time.isoformat()
    alert = message.alert.model_dump(mode="json") if message.alert else None
    alert_json = json.dumps(alert, ensure_ascii=False, separators=(",", ":")) if alert else None
    with DB_LOCK:
        connection = connect_database()
        try:
            cursor = connection.execute(
                "INSERT INTO messages (id, title, body, level, timestamp, kind, alert_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (message_id, message.title, message.body, message.level, timestamp, message.kind, alert_json),
            )
            sequence = int(cursor.lastrowid)
            prune_messages(connection)
            connection.commit()
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Message id already exists") from error
        finally:
            connection.close()

    return {
        "seq": sequence,
        "id": message_id,
        "title": message.title,
        "body": message.body,
        "level": message.level,
        "timestamp": timestamp,
        "kind": message.kind,
        "alert": alert,
    }


def messages_after(sequence: int) -> list[dict]:
    with DB_LOCK:
        connection = connect_database()
        try:
            rows = connection.execute(
                "SELECT seq, id, title, body, level, timestamp, kind, alert_json "
                "FROM messages WHERE seq > ? ORDER BY seq ASC",
                (sequence,),
            ).fetchall()
        finally:
            connection.close()
    messages = []
    for row in rows:
        message = dict(row)
        raw_alert = message.pop("alert_json", None)
        try:
            message["alert"] = json.loads(raw_alert) if raw_alert else None
        except (TypeError, json.JSONDecodeError):
            message["alert"] = None
        messages.append(message)
    return messages


@asynccontextmanager
async def lifespan(_: FastAPI):
    require_configured_token()
    initialize_database()
    yield


app = FastAPI(
    title="Floating Receiver Sender",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, after: int) -> None:
        await websocket.accept()
        async with self._lock:
            for message in messages_after(after):
                await websocket.send_json(message)
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            disconnected: list[WebSocket] = []
            for websocket in self._connections:
                try:
                    await websocket.send_json(message)
                except Exception:
                    disconnected.append(websocket)
            for websocket in disconnected:
                self._connections.discard(websocket)


manager = ConnectionManager()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/messages", status_code=201)
async def create_message(
    message: MessageInput,
    authorization: str | None = Header(default=None),
) -> dict:
    authorize(authorization)
    stored = store_message(message)
    await manager.broadcast(stored)
    return stored


@app.websocket("/ws")
async def receive_messages(
    websocket: WebSocket,
    after: int = Query(default=0, ge=0),
) -> None:
    expected = f"Bearer {TOKEN}"
    authorization = websocket.headers.get("authorization")
    if authorization is None or not secrets.compare_digest(authorization, expected):
        await websocket.close(code=1008)
        return

    try:
        await manager.connect(websocket, after)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
