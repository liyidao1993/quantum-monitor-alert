package com.remix.floatingreceiver.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceivedMessageTest {
    @Test
    fun parsesValidMessage() {
        val message = ReceivedMessage.fromJson(
            """{"seq":7,"id":"m-7","title":"完成","body":"**构建成功**","level":"success","timestamp":"2026-07-19T15:30:00+08:00"}""",
        )

        assertEquals(7L, message?.sequence)
        assertEquals("完成", message?.title)
        assertEquals("构建成功", message?.summary())
    }

    @Test
    fun rejectsInvalidMessage() {
        assertNull(ReceivedMessage.fromJson("""{"seq":0,"title":"bad"}"""))
    }

    @Test
    fun rejectsOversizedBody() {
        val body = "x".repeat(ReceivedMessage.MAX_BODY_LENGTH + 1)
        val raw = """{"seq":1,"id":"m-1","title":"title","body":"$body","level":"info","timestamp":"2026-07-19T15:30:00Z"}"""

        assertNull(ReceivedMessage.fromJson(raw))
        assertTrue(body.length > ReceivedMessage.MAX_BODY_LENGTH)
    }

    @Test
    fun preservesScheduledKindWhenCached() {
        val original = ReceivedMessage(
            sequence = 8,
            id = "ranking-8",
            title = "Quantum Ranking",
            body = "| 排名 | 品种 |",
            level = "info",
            timestamp = "2026-07-20T15:30:00Z",
            kind = ReceivedMessage.KIND_SCHEDULED,
        )

        assertEquals(ReceivedMessage.KIND_SCHEDULED, ReceivedMessage.fromJson(original.toJson())?.kind)
    }

    @Test
    fun parsesStructuredAlertAndBuildsCompactTitle() {
        val message = ReceivedMessage.fromJson(
            """{"seq":9,"id":"a-9","title":"legacy title","body":"details","level":"warning","timestamp":"2026-07-20T12:00:00Z","kind":"alert","alert":{"schema_version":1,"type":"instant_move","symbol":"BTCUSDT","period":"30秒","direction":"up","change_percent":1.256,"threshold_percent":1.0,"triggered_at":"2026-07-20T12:00:00Z"}}""",
        )

        assertEquals("BTCUSDT", message?.alert?.symbol)
        assertEquals("BTCUSDT　30秒　+1.26%", message?.compactTitle())
        assertEquals("BTCUSDT", ReceivedMessage.fromJson(message!!.toJson())?.alert?.symbol)
    }

    @Test
    fun ignoresInvalidStructuredAlertButKeepsLegacyMessage() {
        val message = ReceivedMessage.fromJson(
            """{"seq":10,"id":"a-10","title":"legacy title","body":"details","level":"warning","timestamp":"2026-07-20T12:00:00Z","alert":{"schema_version":2,"symbol":"BTCUSDT"}}""",
        )

        assertEquals("legacy title", message?.compactTitle())
        assertNull(message?.alert)
    }
}
