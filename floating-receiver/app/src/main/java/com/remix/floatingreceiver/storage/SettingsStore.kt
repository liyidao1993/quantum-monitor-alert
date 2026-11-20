package com.remix.floatingreceiver.storage

import android.content.Context
import com.remix.floatingreceiver.model.ReceivedMessage
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    val serverUrl: String
        get() = preferences.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL).orEmpty()

    val token: String
        get() = preferences.getString(KEY_TOKEN, DEFAULT_TOKEN).orEmpty()

    val lastSequence: Long
        get() = preferences.getLong(KEY_LAST_SEQUENCE, 0L)

    var serviceEnabled: Boolean
        get() = preferences.getBoolean(KEY_SERVICE_ENABLED, false)
        set(value) = preferences.edit().putBoolean(KEY_SERVICE_ENABLED, value).apply()

    var connectionState: String
        get() = preferences.getString(KEY_CONNECTION_STATE, STATE_STOPPED).orEmpty()
        set(value) = preferences.edit().putString(KEY_CONNECTION_STATE, value).apply()

    var overlayWidthDp: Int
        get() = preferences.getInt(KEY_OVERLAY_WIDTH, DEFAULT_OVERLAY_WIDTH).coerceIn(180, 400)
        set(value) = preferences.edit().putInt(KEY_OVERLAY_WIDTH, value.coerceIn(180, 400)).apply()

    var overlayOpacityPercent: Int
        get() = preferences.getInt(KEY_OVERLAY_OPACITY, DEFAULT_OVERLAY_OPACITY).coerceIn(50, 100)
        set(value) = preferences.edit().putInt(KEY_OVERLAY_OPACITY, value.coerceIn(50, 100)).apply()

    var overlayTextSizeSp: Int
        get() = preferences.getInt(KEY_OVERLAY_TEXT_SIZE, DEFAULT_OVERLAY_TEXT_SIZE).coerceIn(9, 16)
        set(value) = preferences.edit().putInt(KEY_OVERLAY_TEXT_SIZE, value.coerceIn(9, 16)).apply()

    val lastReceivedAt: Long
        get() = preferences.getLong(KEY_LAST_RECEIVED_AT, 0L)

    fun saveConnection(serverUrl: String, token: String) {
        val changed = serverUrl != this.serverUrl || token != this.token
        preferences.edit()
            .putString(KEY_SERVER_URL, serverUrl)
            .putString(KEY_TOKEN, token)
            .apply {
                if (changed) {
                    putLong(KEY_LAST_SEQUENCE, 0L)
                    remove(KEY_LATEST_SCHEDULED)
                    remove(KEY_RECENT_ALERTS)
                    remove(KEY_LAST_READ_ALERT_ID)
                }
            }
            .apply()
    }

    fun saveLastSequence(sequence: Long) {
        if (sequence > lastSequence) {
            preferences.edit().putLong(KEY_LAST_SEQUENCE, sequence).apply()
        }
    }

    fun recordReceived() {
        val today = LocalDate.now().toString()
        val storedDay = preferences.getString(KEY_RECEIVED_COUNT_DATE, null)
        val count = if (storedDay == today) preferences.getInt(KEY_RECEIVED_TODAY, 0) + 1 else 1
        preferences.edit()
            .putLong(KEY_LAST_RECEIVED_AT, System.currentTimeMillis())
            .putString(KEY_RECEIVED_COUNT_DATE, today)
            .putInt(KEY_RECEIVED_TODAY, count)
            .apply()
    }

    fun receivedTodayCount(): Int =
        if (preferences.getString(KEY_RECEIVED_COUNT_DATE, null) == LocalDate.now().toString()) {
            preferences.getInt(KEY_RECEIVED_TODAY, 0)
        } else {
            0
        }

    fun saveLatestScheduled(message: ReceivedMessage) {
        preferences.edit().putString(KEY_LATEST_SCHEDULED, message.toJson()).apply()
    }

    fun latestScheduled(): ReceivedMessage? =
        preferences.getString(KEY_LATEST_SCHEDULED, null)?.let(ReceivedMessage::fromJson)

    fun saveRecentAlert(message: ReceivedMessage) {
        val messages = (listOf(message) + recentAlerts())
            .distinctBy(ReceivedMessage::id)
            .take(MAX_RECENT_ALERTS)
        val array = JSONArray()
        messages.forEach { array.put(JSONObject(it.toJson())) }
        preferences.edit().putString(KEY_RECENT_ALERTS, array.toString()).apply()
    }

    fun recentAlerts(): List<ReceivedMessage> {
        val raw = preferences.getString(KEY_RECENT_ALERTS, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    ReceivedMessage.fromJson(array.getJSONObject(index).toString())?.let(::add)
                }
            }
        }.getOrDefault(emptyList())
    }

    fun hasRecentAlerts(): Boolean = preferences.contains(KEY_RECENT_ALERTS)

    fun markAlertRead(messageId: String) {
        preferences.edit().putString(KEY_LAST_READ_ALERT_ID, messageId).apply()
    }

    fun isAlertRead(messageId: String): Boolean =
        preferences.getString(KEY_LAST_READ_ALERT_ID, null) == messageId

    fun overlayPosition(): Pair<Int, Int>? {
        if (!preferences.contains(KEY_OVERLAY_X) || !preferences.contains(KEY_OVERLAY_Y)) return null
        return preferences.getInt(KEY_OVERLAY_X, 0) to preferences.getInt(KEY_OVERLAY_Y, 0)
    }

    fun saveOverlayPosition(x: Int, y: Int) {
        preferences.edit()
            .putInt(KEY_OVERLAY_X, x)
            .putInt(KEY_OVERLAY_Y, y)
            .apply()
    }

    companion object {
        const val STATE_STOPPED = "未启动"
        const val STATE_TEST = "本地测试"
        const val STATE_CONNECTING = "正在连接"
        const val STATE_CONNECTED = "已连接"
        const val STATE_DISCONNECTED = "连接断开，正在重试"
        const val STATE_INVALID_CONFIG = "配置无效"

        private const val DEFAULT_SERVER_URL = "ws://35.234.27.229:8765/ws"
        private const val DEFAULT_TOKEN = "bc2a389d7332256aef1f4c6d3f0216c6fac8822cee06c388"
        private const val PREFERENCES_NAME = "floating_receiver_settings"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_LAST_SEQUENCE = "last_sequence"
        private const val KEY_SERVICE_ENABLED = "service_enabled"
        private const val KEY_CONNECTION_STATE = "connection_state"
        private const val KEY_OVERLAY_X = "overlay_x"
        private const val KEY_OVERLAY_Y = "overlay_y"
        private const val KEY_OVERLAY_WIDTH = "overlay_width"
        private const val KEY_OVERLAY_OPACITY = "overlay_opacity"
        private const val KEY_OVERLAY_TEXT_SIZE = "overlay_text_size"
        private const val KEY_LATEST_SCHEDULED = "latest_scheduled"
        private const val KEY_RECENT_ALERTS = "recent_alerts"
        private const val KEY_LAST_READ_ALERT_ID = "last_read_alert_id"
        private const val KEY_LAST_RECEIVED_AT = "last_received_at"
        private const val KEY_RECEIVED_COUNT_DATE = "received_count_date"
        private const val KEY_RECEIVED_TODAY = "received_today"
        private const val MAX_RECENT_ALERTS = 10
        private const val DEFAULT_OVERLAY_WIDTH = 300
        private const val DEFAULT_OVERLAY_OPACITY = 93
        private const val DEFAULT_OVERLAY_TEXT_SIZE = 12
    }
}
