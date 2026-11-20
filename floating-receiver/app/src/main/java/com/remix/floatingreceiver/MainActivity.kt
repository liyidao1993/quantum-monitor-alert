package com.remix.floatingreceiver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.remix.floatingreceiver.service.OverlayService
import com.remix.floatingreceiver.storage.SettingsStore
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : AppCompatActivity() {
    private lateinit var settingsStore: SettingsStore
    private lateinit var serverUrlInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var receiverToggleButton: Button
    private lateinit var connectionSettingsGroup: View
    private lateinit var connectionSettingsToggle: Button

    private val statusHandler = Handler(Looper.getMainLooper())
    private var pendingAction: PendingAction? = null

    private val overlayPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        if (Settings.canDrawOverlays(this)) {
            continuePendingAction()
        } else {
            pendingAction = null
            toast(getString(R.string.overlay_permission_required))
        }
        refreshStatus()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        continuePendingAction(skipNotificationCheck = true)
        refreshStatus()
    }

    private val statusRefresh = object : Runnable {
        override fun run() {
            refreshStatus()
            statusHandler.postDelayed(this, STATUS_REFRESH_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settingsStore = SettingsStore(this)
        serverUrlInput = findViewById(R.id.serverUrlInput)
        tokenInput = findViewById(R.id.tokenInput)
        receiverToggleButton = findViewById(R.id.receiverToggleButton)
        connectionSettingsGroup = findViewById(R.id.connectionSettingsGroup)
        connectionSettingsToggle = findViewById(R.id.connectionSettingsToggle)

        serverUrlInput.setText(settingsStore.serverUrl)
        tokenInput.setText(settingsStore.token)
        setupAppearanceControls()

        findViewById<Button>(R.id.showLatestButton).setOnClickListener { showLatestAlert() }
        findViewById<Button>(R.id.testButton).setOnClickListener { requestAction(PendingAction.TEST) }
        findViewById<Button>(R.id.reconnectButton).setOnClickListener { requestAction(PendingAction.RECONNECT) }
        receiverToggleButton.setOnClickListener {
            if (settingsStore.serviceEnabled) stopReceiver() else requestAction(PendingAction.START)
        }
        findViewById<Button>(R.id.grantOverlayButton).setOnClickListener { requestOverlayPermission() }
        findViewById<Button>(R.id.saveConnectionButton).setOnClickListener {
            if (validateAndSaveConnection()) {
                toast(getString(R.string.connection_saved))
                requestAction(PendingAction.START, validateConnection = false)
            }
        }
        connectionSettingsToggle.setOnClickListener { toggleConnectionSettings() }
        refreshStatus()
    }

    override fun onStart() {
        super.onStart()
        statusHandler.post(statusRefresh)
    }

    override fun onStop() {
        statusHandler.removeCallbacks(statusRefresh)
        super.onStop()
    }

    private fun requestAction(action: PendingAction, validateConnection: Boolean = action == PendingAction.START) {
        if (validateConnection && !validateAndSaveConnection()) return
        pendingAction = action
        continuePendingAction()
    }

    private fun continuePendingAction(skipNotificationCheck: Boolean = false) {
        val action = pendingAction ?: return
        if (!Settings.canDrawOverlays(this)) {
            requestOverlayPermission()
            return
        }
        if (!skipNotificationCheck && needsNotificationPermission()) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }

        val serviceAction = when (action) {
            PendingAction.START -> OverlayService.ACTION_START
            PendingAction.TEST -> OverlayService.ACTION_TEST
            PendingAction.RECONNECT -> OverlayService.ACTION_RECONNECT
        }
        ContextCompat.startForegroundService(
            this,
            Intent(this, OverlayService::class.java).apply { this.action = serviceAction },
        )
        pendingAction = null
        toast(
            getString(
                when (action) {
                    PendingAction.START -> R.string.receiver_started
                    PendingAction.TEST -> R.string.test_shown
                    PendingAction.RECONNECT -> R.string.reconnecting
                },
            ),
        )
        refreshStatus()
    }

    private fun validateAndSaveConnection(): Boolean {
        val serverUrl = serverUrlInput.text.toString().trim().trimEnd('/')
        val token = tokenInput.text.toString().trim()
        val allowedScheme = serverUrl.startsWith("wss://") ||
            (BuildConfig.DEBUG && serverUrl.startsWith("ws://"))

        if (!allowedScheme || !serverUrl.contains("/ws")) {
            toast(getString(if (BuildConfig.DEBUG) R.string.invalid_ws_debug else R.string.invalid_ws_release))
            return false
        }
        if (token.length < 16) {
            toast(getString(R.string.invalid_token))
            return false
        }

        settingsStore.saveConnection(serverUrl, token)
        return true
    }

    private fun stopReceiver() {
        ContextCompat.startForegroundService(
            this,
            Intent(this, OverlayService::class.java).apply { action = OverlayService.ACTION_STOP },
        )
        toast(getString(R.string.receiver_stopped))
        refreshStatus()
    }

    private fun showLatestAlert() {
        val message = settingsStore.recentAlerts().firstOrNull()
        if (message == null) {
            toast(getString(R.string.no_alert_message))
            return
        }
        startActivity(AlertDetailActivity.createIntent(this, message))
    }

    private fun setupAppearanceControls() {
        bindSeekBar(
            seekBarId = R.id.widthSeekBar,
            labelId = R.id.widthValueText,
            initialValue = settingsStore.overlayWidthDp,
            label = { getString(R.string.width_value_format, it) },
            save = { settingsStore.overlayWidthDp = it },
        )
        bindSeekBar(
            seekBarId = R.id.opacitySeekBar,
            labelId = R.id.opacityValueText,
            initialValue = settingsStore.overlayOpacityPercent,
            label = { getString(R.string.opacity_value_format, it) },
            save = { settingsStore.overlayOpacityPercent = it },
        )
        bindSeekBar(
            seekBarId = R.id.textSizeSeekBar,
            labelId = R.id.textSizeValueText,
            initialValue = settingsStore.overlayTextSizeSp,
            label = { getString(R.string.text_size_value_format, it) },
            save = { settingsStore.overlayTextSizeSp = it },
        )
    }

    private fun bindSeekBar(
        seekBarId: Int,
        labelId: Int,
        initialValue: Int,
        label: (Int) -> String,
        save: (Int) -> Unit,
    ) {
        val valueText = findViewById<TextView>(labelId)
        val seekBar = findViewById<SeekBar>(seekBarId)
        seekBar.progress = initialValue
        valueText.text = label(initialValue)
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                valueText.text = label(progress)
            }

            override fun onStartTrackingTouch(seekBar: SeekBar) = Unit

            override fun onStopTrackingTouch(seekBar: SeekBar) {
                save(seekBar.progress)
                refreshOverlayAppearance()
            }
        })
    }

    private fun refreshOverlayAppearance() {
        if (!settingsStore.serviceEnabled) return
        ContextCompat.startForegroundService(
            this,
            Intent(this, OverlayService::class.java).apply { action = OverlayService.ACTION_REFRESH },
        )
    }

    private fun toggleConnectionSettings() {
        val show = connectionSettingsGroup.visibility != View.VISIBLE
        connectionSettingsGroup.visibility = if (show) View.VISIBLE else View.GONE
        connectionSettingsToggle.setText(
            if (show) R.string.hide_connection_settings else R.string.connection_settings,
        )
    }

    private fun requestOverlayPermission() {
        overlayPermissionLauncher.launch(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName"),
            ),
        )
    }

    private fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED

    private fun refreshStatus() {
        val state = settingsStore.connectionState
        val connected = state == SettingsStore.STATE_CONNECTED
        findViewById<TextView>(R.id.connectionStateText).apply {
            text = state
            setTextColor(ContextCompat.getColor(this@MainActivity, if (connected) R.color.positive else R.color.text_primary))
        }
        findViewById<TextView>(R.id.cloudReachableText).apply {
            setText(if (connected) R.string.cloud_online else R.string.cloud_offline)
            setTextColor(ContextCompat.getColor(this@MainActivity, if (connected) R.color.positive else R.color.negative))
        }
        findViewById<TextView>(R.id.lastReceivedText).text = formatLastReceived(settingsStore.lastReceivedAt)
        findViewById<TextView>(R.id.todayCountText).text =
            getString(R.string.message_count_format, settingsStore.receivedTodayCount())

        val overlayGranted = Settings.canDrawOverlays(this)
        val notificationsGranted = !needsNotificationPermission()
        val powerManager = getSystemService(PowerManager::class.java)
        val batteryUnrestricted = powerManager.isIgnoringBatteryOptimizations(packageName)
        findViewById<TextView>(R.id.overlayPermissionText).text = getString(
            R.string.permission_status_format,
            getString(R.string.overlay_permission),
            getString(if (overlayGranted) R.string.permission_granted else R.string.permission_denied),
        )
        findViewById<TextView>(R.id.notificationPermissionText).text = getString(
            R.string.permission_status_format,
            getString(R.string.notification_permission),
            getString(if (notificationsGranted) R.string.permission_granted else R.string.permission_denied),
        )
        findViewById<TextView>(R.id.batteryStatusText).text = getString(
            R.string.permission_status_format,
            getString(R.string.battery_optimization),
            getString(if (batteryUnrestricted) R.string.battery_unrestricted else R.string.battery_optimized),
        )
        findViewById<Button>(R.id.grantOverlayButton).visibility = if (overlayGranted) View.GONE else View.VISIBLE

        receiverToggleButton.setText(
            if (settingsStore.serviceEnabled) R.string.stop_receiving else R.string.start_receiving,
        )
        findViewById<Button>(R.id.reconnectButton).isEnabled = settingsStore.serviceEnabled
        findViewById<Button>(R.id.showLatestButton).isEnabled = settingsStore.hasRecentAlerts()
    }

    private fun formatLastReceived(timestamp: Long): String = if (timestamp <= 0) {
        getString(R.string.never_received)
    } else {
        Instant.ofEpochMilli(timestamp)
            .atZone(ZoneId.systemDefault())
            .format(LAST_RECEIVED_FORMAT)
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    private enum class PendingAction { START, TEST, RECONNECT }

    companion object {
        private const val STATUS_REFRESH_MS = 2_000L
        private val LAST_RECEIVED_FORMAT = DateTimeFormatter.ofPattern("MM-dd HH:mm")
    }
}
