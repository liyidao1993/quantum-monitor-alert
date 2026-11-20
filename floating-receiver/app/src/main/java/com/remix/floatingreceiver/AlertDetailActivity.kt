package com.remix.floatingreceiver

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.remix.floatingreceiver.model.ReceivedMessage
import com.remix.floatingreceiver.render.MarkdownRenderer
import com.remix.floatingreceiver.storage.SettingsStore
import kotlin.math.abs

class AlertDetailActivity : AppCompatActivity() {
    private lateinit var settingsStore: SettingsStore
    private val markdownRenderer by lazy(LazyThreadSafetyMode.NONE) { MarkdownRenderer(this) }
    private var alerts: List<ReceivedMessage> = emptyList()
    private var currentIndex = 0
    private var showingScheduled = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_alert_detail)
        settingsStore = SettingsStore(this)

        val intentMessage = intent.getStringExtra(EXTRA_MESSAGE_JSON)?.let(ReceivedMessage::fromJson)
        alerts = (listOfNotNull(intentMessage?.takeIf { it.kind == ReceivedMessage.KIND_ALERT }) +
            settingsStore.recentAlerts())
            .distinctBy(ReceivedMessage::id)

        currentIndex = savedInstanceState?.getInt(STATE_INDEX)
            ?: alerts.indexOfFirst { it.id == intentMessage?.id }.coerceAtLeast(0)
        showingScheduled = savedInstanceState?.getBoolean(STATE_SCHEDULED)
            ?: intent.getBooleanExtra(EXTRA_SHOW_SCHEDULED, false)

        findViewById<Button>(R.id.detailBackButton).setOnClickListener { finish() }
        findViewById<Button>(R.id.previousButton).setOnClickListener { showOlderAlert() }
        findViewById<Button>(R.id.nextButton).setOnClickListener { showNewerAlert() }
        findViewById<Button>(R.id.copySymbolButton).setOnClickListener { copySymbol() }
        findViewById<Button>(R.id.copyBodyButton).setOnClickListener { copyBody() }
        findViewById<Button>(R.id.scheduledButton).setOnClickListener { toggleScheduled() }
        attachSwipeNavigation()

        if (!showingScheduled && alerts.isEmpty()) {
            Toast.makeText(this, R.string.no_alert_message, Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        renderCurrent()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(STATE_INDEX, currentIndex)
        outState.putBoolean(STATE_SCHEDULED, showingScheduled)
        super.onSaveInstanceState(outState)
    }

    private fun renderCurrent() {
        val message = if (showingScheduled) settingsStore.latestScheduled() else alerts.getOrNull(currentIndex)
        if (message == null) {
            Toast.makeText(
                this,
                if (showingScheduled) R.string.no_scheduled_message else R.string.no_alert_message,
                Toast.LENGTH_SHORT,
            ).show()
            showingScheduled = false
            alerts.getOrNull(currentIndex)?.let { renderMessage(it) } ?: finish()
            return
        }
        renderMessage(message)
    }

    private fun renderMessage(message: ReceivedMessage) {
        val alert = message.alert
        val isAlert = message.kind == ReceivedMessage.KIND_ALERT
        findViewById<TextView>(R.id.detailScreenTitle).setText(
            if (showingScheduled) R.string.scheduled_detail_title else R.string.alert_detail_title,
        )
        findViewById<TextView>(R.id.detailAlertTitle).text =
            if (isAlert) message.compactTitle() else message.title

        val direction = findViewById<TextView>(R.id.detailDirection)
        if (alert == null || !isAlert) {
            direction.visibility = View.GONE
        } else {
            val positive = alert.changePercent >= 0
            direction.visibility = View.VISIBLE
            direction.setText(if (positive) R.string.up_symbol else R.string.down_symbol)
            direction.setTextColor(ContextCompat.getColor(this, if (positive) R.color.positive else R.color.negative))
        }

        findViewById<TextView>(R.id.detailMeta).text = if (alert != null && isAlert) {
            getString(
                R.string.alert_meta_format,
                getString(if (alert.type == "instant_move") R.string.alert_type_instant else R.string.alert_type_ma60),
                alert.thresholdPercent,
                message.displayDateTime(),
            )
        } else {
            message.displayDateTime()
        }
        markdownRenderer.render(findViewById(R.id.detailBody), message.body)

        val readStatus = findViewById<TextView>(R.id.readStatusText)
        readStatus.visibility = if (isAlert) View.VISIBLE else View.GONE
        if (isAlert) settingsStore.markAlertRead(message.id)

        val previous = findViewById<Button>(R.id.previousButton)
        val next = findViewById<Button>(R.id.nextButton)
        previous.isEnabled = !showingScheduled && currentIndex < alerts.lastIndex
        next.isEnabled = !showingScheduled && currentIndex > 0
        findViewById<TextView>(R.id.historyPositionText).text = if (showingScheduled) {
            getString(R.string.scheduled_detail_title)
        } else {
            getString(R.string.history_position, currentIndex + 1, alerts.size)
        }

        findViewById<Button>(R.id.copySymbolButton).isEnabled = alert?.symbol?.isNotBlank() == true
        findViewById<Button>(R.id.scheduledButton).setText(
            if (showingScheduled) R.string.back_to_alert else R.string.view_scheduled,
        )
    }

    private fun showOlderAlert() {
        if (showingScheduled || currentIndex >= alerts.lastIndex) return
        currentIndex += 1
        renderCurrent()
    }

    private fun showNewerAlert() {
        if (showingScheduled || currentIndex <= 0) return
        currentIndex -= 1
        renderCurrent()
    }

    private fun toggleScheduled() {
        if (!showingScheduled && settingsStore.latestScheduled() == null) {
            Toast.makeText(this, R.string.no_scheduled_message, Toast.LENGTH_SHORT).show()
            return
        }
        showingScheduled = !showingScheduled
        renderCurrent()
    }

    private fun copySymbol() {
        val symbol = alerts.getOrNull(currentIndex)?.alert?.symbol ?: return
        copyText("symbol", symbol)
        Toast.makeText(this, R.string.symbol_copied, Toast.LENGTH_SHORT).show()
    }

    private fun copyBody() {
        val message = if (showingScheduled) settingsStore.latestScheduled() else alerts.getOrNull(currentIndex)
        message ?: return
        copyText("message", message.body)
        Toast.makeText(this, R.string.body_copied, Toast.LENGTH_SHORT).show()
    }

    private fun copyText(label: String, value: String) {
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText(label, value))
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachSwipeNavigation() {
        val swipeArea = findViewById<View>(R.id.detailSwipeArea)
        swipeArea.isClickable = true
        val detector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean = true

            override fun onSingleTapUp(event: MotionEvent): Boolean {
                swipeArea.performClick()
                return true
            }

            override fun onFling(
                downEvent: MotionEvent?,
                moveEvent: MotionEvent,
                velocityX: Float,
                velocityY: Float,
            ): Boolean {
                val down = downEvent ?: return false
                val distanceX = moveEvent.x - down.x
                if (abs(distanceX) < SWIPE_DISTANCE || abs(velocityX) < SWIPE_VELOCITY) return false
                if (abs(distanceX) <= abs(moveEvent.y - down.y)) return false
                if (distanceX < 0) showOlderAlert() else showNewerAlert()
                return true
            }
        })
        swipeArea.setOnTouchListener { _, event -> detector.onTouchEvent(event) }
    }

    companion object {
        private const val EXTRA_MESSAGE_JSON = "message_json"
        private const val EXTRA_SHOW_SCHEDULED = "show_scheduled"
        private const val STATE_INDEX = "current_index"
        private const val STATE_SCHEDULED = "showing_scheduled"
        private const val SWIPE_DISTANCE = 80f
        private const val SWIPE_VELOCITY = 80f

        fun createIntent(context: Context, message: ReceivedMessage? = null): Intent =
            Intent(context, AlertDetailActivity::class.java).apply {
                message?.let { putExtra(EXTRA_MESSAGE_JSON, it.toJson()) }
            }

        fun createScheduledIntent(context: Context): Intent =
            Intent(context, AlertDetailActivity::class.java).putExtra(EXTRA_SHOW_SCHEDULED, true)
    }
}
