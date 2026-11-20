package com.remix.floatingreceiver.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.remix.floatingreceiver.MainActivity
import com.remix.floatingreceiver.R
import com.remix.floatingreceiver.model.AlertFields
import com.remix.floatingreceiver.model.ReceivedMessage
import com.remix.floatingreceiver.network.MessageSocketClient
import com.remix.floatingreceiver.overlay.OverlayWindowController
import com.remix.floatingreceiver.storage.SettingsStore
import java.time.Duration
import java.time.OffsetDateTime
import kotlin.math.abs

class OverlayService : Service(), MessageSocketClient.Listener {
    private lateinit var settingsStore: SettingsStore
    private lateinit var overlayController: OverlayWindowController
    private var socketClient: MessageSocketClient? = null
    private var alertRingtone: Ringtone? = null

    override fun onCreate() {
        super.onCreate()
        settingsStore = SettingsStore(this)
        overlayController = OverlayWindowController(this, settingsStore)
        createNotificationChannel()
        startAsForeground(getString(R.string.notification_connecting))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopReceiver()
                return START_NOT_STICKY
            }

            ACTION_TEST -> showTestMessage()
            ACTION_REFRESH -> overlayController.refreshAppearance()
            ACTION_SHOW_OVERLAY -> {
                if (settingsStore.serviceEnabled) startReceiver()
                showLatestOverlay()
            }
            ACTION_RECONNECT -> reconnectReceiver()
            ACTION_START -> startReceiver()
            else -> if (settingsStore.serviceEnabled) startReceiver() else stopReceiver()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        socketClient?.stop()
        socketClient = null
        alertRingtone?.stop()
        alertRingtone = null
        overlayController.dismiss()
        if (settingsStore.serviceEnabled) {
            settingsStore.connectionState = SettingsStore.STATE_DISCONNECTED
        }
        super.onDestroy()
    }

    override fun onStateChanged(state: MessageSocketClient.State) {
        val (storedState, notificationText) = when (state) {
            MessageSocketClient.State.CONNECTING ->
                SettingsStore.STATE_CONNECTING to getString(R.string.notification_connecting)
            MessageSocketClient.State.CONNECTED ->
                SettingsStore.STATE_CONNECTED to getString(R.string.notification_connected)
            MessageSocketClient.State.DISCONNECTED ->
                SettingsStore.STATE_DISCONNECTED to getString(R.string.notification_disconnected)
        }
        settingsStore.connectionState = storedState
        updateNotification(notificationText)
    }

    override fun onMessage(message: ReceivedMessage) {
        if (message.sequence <= settingsStore.lastSequence) {
            socketClient?.acknowledge(settingsStore.lastSequence)
            return
        }
        settingsStore.saveLastSequence(message.sequence)
        socketClient?.acknowledge(message.sequence)
        settingsStore.recordReceived()
        if (message.kind == ReceivedMessage.KIND_SCHEDULED) {
            settingsStore.saveLatestScheduled(message)
            updateNotification("收到定时排名")
            return
        }
        settingsStore.saveRecentAlert(message)
        playAlertSoundIfRecent(message)
        overlayController.show(message)
        updateNotification(message.compactTitle())
    }

    override fun onInvalidMessage() {
        Log.w(TAG, "Ignored an invalid or oversized message")
    }

    private fun startReceiver() {
        if (!Settings.canDrawOverlays(this)) {
            settingsStore.serviceEnabled = false
            settingsStore.connectionState = SettingsStore.STATE_INVALID_CONFIG
            stopSelf()
            return
        }
        val endpoint = settingsStore.serverUrl
        val token = settingsStore.token
        if (endpoint.isBlank() || token.length < 16) {
            settingsStore.serviceEnabled = false
            settingsStore.connectionState = SettingsStore.STATE_INVALID_CONFIG
            updateNotification("服务器配置无效")
            return
        }
        if (socketClient != null) return

        settingsStore.serviceEnabled = true
        socketClient = MessageSocketClient(this).also {
            it.start(endpoint, token, settingsStore.lastSequence)
        }
    }

    private fun reconnectReceiver() {
        socketClient?.stop()
        socketClient = null
        settingsStore.connectionState = SettingsStore.STATE_CONNECTING
        startReceiver()
    }

    private fun showTestMessage() {
        if (!Settings.canDrawOverlays(this)) return
        if (socketClient == null) startReceiver()
        val now = OffsetDateTime.now()
        val message = ReceivedMessage(
            sequence = settingsStore.lastSequence + 1,
            id = "local-test-${System.currentTimeMillis()}",
            title = "SPCX　90秒　+3.21%",
            body = "## 价格异动\n\n| 品种 | 周期 | 涨跌幅 |\n|---|---:|---:|\n| SPCX | 90秒 | +3.21% |\n\n| 指标 | 数值 |\n|---|---:|\n| 当前价 | 108.37 |\n| 告警阈值 | 3.00% |\n\n点击小窗进入全屏，长按隐藏当前小窗。",
            level = "warning",
            timestamp = now.toString(),
            kind = ReceivedMessage.KIND_ALERT,
            alert = AlertFields(
                schemaVersion = 1,
                type = "instant_move",
                symbol = "SPCX",
                period = "90秒",
                direction = "up",
                changePercent = 3.21,
                thresholdPercent = 3.0,
                triggeredAt = now.toString(),
            ),
        )
        overlayController.show(message)
        updateNotification("测试告警已显示")
    }

    private fun showLatestOverlay() {
        if (!Settings.canDrawOverlays(this)) return
        if (!overlayController.showLatestAlert()) {
            Toast.makeText(this, R.string.no_alert_message, Toast.LENGTH_SHORT).show()
        }
    }

    private fun playAlertSoundIfRecent(message: ReceivedMessage) {
        val messageTime = runCatching { OffsetDateTime.parse(message.timestamp) }.getOrNull() ?: return
        val age = abs(Duration.between(messageTime, OffsetDateTime.now()).seconds)
        if (age > MAX_SOUND_AGE_SECONDS) return

        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
        alertRingtone?.stop()
        alertRingtone = RingtoneManager.getRingtone(this, soundUri)?.also { it.play() }
    }

    private fun stopReceiver() {
        settingsStore.serviceEnabled = false
        settingsStore.connectionState = SettingsStore.STATE_STOPPED
        socketClient?.stop()
        socketClient = null
        overlayController.dismiss()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startAsForeground(text: String) {
        val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(text),
            serviceType,
        )
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, OverlayService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val showOverlayIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, OverlayService::class.java).apply { action = ACTION_SHOW_OVERLAY },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_running))
            .setContentText(text)
            .setContentIntent(openIntent)
            .addAction(0, getString(R.string.notification_show_overlay), showOverlayIntent)
            .addAction(0, getString(R.string.notification_stop), stopIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "com.remix.floatingreceiver.action.START"
        const val ACTION_STOP = "com.remix.floatingreceiver.action.STOP"
        const val ACTION_TEST = "com.remix.floatingreceiver.action.TEST"
        const val ACTION_REFRESH = "com.remix.floatingreceiver.action.REFRESH"
        const val ACTION_SHOW_OVERLAY = "com.remix.floatingreceiver.action.SHOW_OVERLAY"
        const val ACTION_RECONNECT = "com.remix.floatingreceiver.action.RECONNECT"

        private const val CHANNEL_ID = "floating_receiver_service"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "OverlayService"
        private const val MAX_SOUND_AGE_SECONDS = 120L
    }
}
