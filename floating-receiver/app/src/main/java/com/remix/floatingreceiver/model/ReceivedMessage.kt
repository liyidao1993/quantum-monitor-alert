package com.remix.floatingreceiver.model

import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class AlertFields(
    val schemaVersion: Int,
    val type: String,
    val symbol: String,
    val period: String,
    val direction: String,
    val changePercent: Double,
    val thresholdPercent: Double,
    val triggeredAt: String,
) {
    fun compactTitle(): String = String.format(
        Locale.US,
        "%s　%s　%+.2f%%",
        symbol,
        period,
        changePercent,
    )

    fun toJson(): JSONObject = JSONObject()
        .put("schema_version", schemaVersion)
        .put("type", type)
        .put("symbol", symbol)
        .put("period", period)
        .put("direction", direction)
        .put("change_percent", changePercent)
        .put("threshold_percent", thresholdPercent)
        .put("triggered_at", triggeredAt)

    companion object {
        private val TYPES = setOf("instant_move", "ma60_deviation")
        private val DIRECTIONS = setOf("up", "down")

        fun fromJson(json: JSONObject?): AlertFields? = runCatching {
            requireNotNull(json)
            val schemaVersion = json.optInt("schema_version", -1)
            val type = json.optString("type").trim()
            val symbol = json.optString("symbol").trim()
            val period = json.optString("period").trim()
            val direction = json.optString("direction").trim()
            val changePercent = json.optDouble("change_percent", Double.NaN)
            val thresholdPercent = json.optDouble("threshold_percent", Double.NaN)
            val triggeredAt = json.optString("triggered_at").trim()

            require(schemaVersion == 1)
            require(type in TYPES)
            require(symbol.isNotEmpty() && symbol.length <= 40)
            require(period.isNotEmpty() && period.length <= 20)
            require(direction in DIRECTIONS)
            require(changePercent.isFinite())
            require(thresholdPercent.isFinite() && thresholdPercent >= 0)
            require(triggeredAt.isNotEmpty())

            AlertFields(
                schemaVersion,
                type,
                symbol,
                period,
                direction,
                changePercent,
                thresholdPercent,
                triggeredAt,
            )
        }.getOrNull()
    }
}

data class ReceivedMessage(
    val sequence: Long,
    val id: String,
    val title: String,
    val body: String,
    val level: String,
    val timestamp: String,
    val kind: String = KIND_ALERT,
    val alert: AlertFields? = null,
) {
    fun compactTitle(): String = alert?.compactTitle() ?: title

    fun summary(): String = body
        .replace(Regex("[`*_>#~\\[\\]()]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
        .take(100)

    fun displayTime(): String = runCatching {
        OffsetDateTime.parse(timestamp)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(TIME_FORMAT)
    }.getOrDefault("")

    fun displayDateTime(): String = runCatching {
        OffsetDateTime.parse(timestamp)
            .atZoneSameInstant(ZoneId.systemDefault())
            .format(DATE_TIME_FORMAT)
    }.getOrDefault(timestamp)

    fun toJson(): String = JSONObject().apply {
        put("seq", sequence)
        put("id", id)
        put("title", title)
        put("body", body)
        put("level", level)
        put("timestamp", timestamp)
        put("kind", kind)
        alert?.let { put("alert", it.toJson()) }
    }.toString()

    companion object {
        const val KIND_ALERT = "alert"
        const val KIND_SCHEDULED = "scheduled"
        const val MAX_TITLE_LENGTH = 120
        const val MAX_BODY_LENGTH = 32_768
        private val TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm")
        private val DATE_TIME_FORMAT = DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")
        private val LEVELS = setOf("info", "success", "warning", "error")

        fun fromJson(raw: String): ReceivedMessage? = runCatching {
            val json = JSONObject(raw)
            val sequence = json.optLong("seq", -1)
            val id = json.optString("id").trim()
            val title = json.optString("title").trim()
            val body = json.optString("body")
            val level = json.optString("level", "info")
            val timestamp = json.optString("timestamp")
            val alert = AlertFields.fromJson(json.optJSONObject("alert"))
            val rawKind = json.optString("kind")
            val kind = when {
                rawKind == KIND_SCHEDULED -> KIND_SCHEDULED
                title.startsWith("Quantum Ranking") || title.contains("轻量守护") -> KIND_SCHEDULED
                else -> KIND_ALERT
            }

            require(sequence > 0)
            require(id.isNotEmpty())
            require(title.isNotEmpty() && title.length <= MAX_TITLE_LENGTH)
            require(body.isNotEmpty() && body.length <= MAX_BODY_LENGTH)
            require(level in LEVELS)
            require(timestamp.isNotEmpty())

            ReceivedMessage(sequence, id, title, body, level, timestamp, kind, alert)
        }.getOrNull()
    }
}
