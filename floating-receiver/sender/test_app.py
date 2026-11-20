import os
import tempfile
from pathlib import Path

os.environ["RECEIVER_TOKEN"] = "test-token-at-least-16-characters"

from fastapi.testclient import TestClient

import app as sender_app


def test_send_authentication_and_websocket_backlog() -> None:
    with tempfile.TemporaryDirectory() as directory:
        sender_app.DATABASE_PATH = Path(directory) / "messages.db"
        headers = {"Authorization": f"Bearer {sender_app.TOKEN}"}

        with TestClient(sender_app.app) as client:
            assert client.get("/health").json() == {"status": "ok"}
            assert client.post(
                "/api/messages",
                json={"title": "unauthorized", "body": "message"},
            ).status_code == 401

            first = client.post(
                "/api/messages",
                headers=headers,
                json={
                    "id": "message-1",
                    "title": "构建完成",
                    "body": "    保留 Markdown 缩进",
                    "level": "success",
                    "alert": {
                        "schema_version": 1,
                        "type": "instant_move",
                        "symbol": "BTCUSDT",
                        "period": "30秒",
                        "direction": "up",
                        "change_percent": 1.25,
                        "threshold_percent": 1.0,
                        "triggered_at": "2026-07-20T12:00:00Z",
                    },
                },
            )
            assert first.status_code == 201
            assert first.json()["seq"] == 1
            assert first.json()["body"].startswith("    ")
            assert first.json()["kind"] == "alert"
            assert first.json()["alert"]["symbol"] == "BTCUSDT"
            assert first.json()["alert"]["change_percent"] == 1.25

            second = client.post(
                "/api/messages",
                headers=headers,
                json={
                    "id": "message-2",
                    "title": "第二条",
                    "body": "正文",
                    "kind": "scheduled",
                },
            )
            assert second.status_code == 201

            with client.websocket_connect("/ws?after=1", headers=headers) as websocket:
                backlog = websocket.receive_json()
                assert backlog["seq"] == 2
                assert backlog["id"] == "message-2"
                assert backlog["kind"] == "scheduled"

                live_response = client.post(
                    "/api/messages",
                    headers=headers,
                    json={"id": "message-3", "title": "实时消息", "body": "正文"},
                )
                assert live_response.status_code == 201
                live_message = websocket.receive_json()
                assert live_message["seq"] == 3
                assert live_message["id"] == "message-3"
                assert live_message["alert"] is None

            duplicate = client.post(
                "/api/messages",
                headers=headers,
                json={"id": "message-1", "title": "重复", "body": "正文"},
            )
            assert duplicate.status_code == 409

            oversized = client.post(
                "/api/messages",
                headers=headers,
                json={"title": "过长", "body": "x" * 32_769},
            )
            assert oversized.status_code == 422


def test_retention_keeps_latest_scheduled_and_recent_alerts() -> None:
    original_max_messages = sender_app.MAX_MESSAGES
    try:
        sender_app.MAX_MESSAGES = 2
        with tempfile.TemporaryDirectory() as directory:
            sender_app.DATABASE_PATH = Path(directory) / "messages.db"
            sender_app.initialize_database()

            sender_app.store_message(sender_app.MessageInput(
                id="scheduled-1",
                title="Quantum Ranking",
                body="定时推送",
                kind="scheduled",
            ))
            for index in range(3):
                sender_app.store_message(sender_app.MessageInput(
                    id=f"alert-{index}",
                    title=f"告警 {index}",
                    body="正文",
                ))

            messages = sender_app.messages_after(0)
            assert [message["id"] for message in messages] == [
                "scheduled-1",
                "alert-1",
                "alert-2",
            ]
    finally:
        sender_app.MAX_MESSAGES = original_max_messages
