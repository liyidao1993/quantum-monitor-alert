package com.remix.floatingreceiver.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.widget.TextViewCompat
import com.remix.floatingreceiver.AlertDetailActivity
import com.remix.floatingreceiver.R
import com.remix.floatingreceiver.model.ReceivedMessage
import com.remix.floatingreceiver.storage.SettingsStore
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min

class OverlayWindowController(
    private val context: Context,
    private val settingsStore: SettingsStore,
) {
    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val inflater = LayoutInflater.from(context)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentView: View? = null
    private var currentParams: WindowManager.LayoutParams? = null
    private var currentMessage: ReceivedMessage? = null

    fun show(message: ReceivedMessage) {
        currentMessage = message
        if (currentView == null) showCompact() else updateVisibleContent(message)
    }

    fun dismiss() {
        mainHandler.removeCallbacksAndMessages(null)
        currentView?.let { view -> runCatching { windowManager.removeView(view) } }
        currentView = null
        currentParams = null
        currentMessage = null
    }

    fun refreshAppearance() {
        if (currentMessage != null) showCompact()
    }

    fun showLatestAlert(): Boolean {
        val message = settingsStore.recentAlerts().firstOrNull() ?: return false
        show(message)
        return true
    }

    @SuppressLint("InflateParams")
    private fun showCompact() {
        val message = currentMessage ?: return
        replaceView(inflater.inflate(R.layout.overlay_compact, null), compactParams())
        updateVisibleContent(message)
        attachDragHandler()
    }

    private fun replaceView(view: View, params: WindowManager.LayoutParams) {
        currentView?.let { oldView -> runCatching { windowManager.removeView(oldView) } }
        currentView = null
        currentParams = null
        view.clipToOutline = true
        runCatching { windowManager.addView(view, params) }
            .onSuccess {
                currentView = view
                currentParams = params
            }
    }

    private fun updateVisibleContent(message: ReceivedMessage) {
        val view = currentView ?: return
        val alert = message.alert
        val direction = view.findViewById<TextView>(R.id.compactDirection)
        val symbol = view.findViewById<TextView>(R.id.compactSymbol)
        val period = view.findViewById<TextView>(R.id.compactPeriod)
        val change = view.findViewById<TextView>(R.id.compactChange)
        val maxTextSize = settingsStore.overlayTextSizeSp

        if (alert == null) {
            direction.setText(R.string.neutral_symbol)
            direction.setTextColor(levelColor(message.level))
            symbol.text = message.compactTitle()
            period.visibility = View.GONE
            change.visibility = View.GONE
        } else {
            val positive = alert.changePercent >= 0
            val color = ContextCompat.getColor(context, if (positive) R.color.positive else R.color.negative)
            direction.setText(if (positive) R.string.up_symbol else R.string.down_symbol)
            direction.setTextColor(color)
            symbol.text = alert.symbol
            period.visibility = View.VISIBLE
            period.text = alert.period
            change.visibility = View.VISIBLE
            change.text = String.format(Locale.US, "%+.2f%%", alert.changePercent)
            change.setTextColor(color)
        }

        listOf(direction, symbol, period, change).forEach { text ->
            text.setTextSize(TypedValue.COMPLEX_UNIT_SP, maxTextSize.toFloat())
            TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(
                text,
                8,
                maxTextSize,
                1,
                TypedValue.COMPLEX_UNIT_SP,
            )
        }
    }

    private fun attachDragHandler() {
        val view = currentView ?: return
        val params = currentParams ?: return
        val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        var startX = 0
        var startY = 0
        var downX = 0f
        var downY = 0f
        var moved = false
        var longPressed = false
        val longPress = Runnable {
            if (!moved) {
                longPressed = true
                dismiss()
                Toast.makeText(context, R.string.overlay_hidden, Toast.LENGTH_SHORT).show()
            }
        }

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    downX = event.rawX
                    downY = event.rawY
                    moved = false
                    longPressed = false
                    mainHandler.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downX).toInt()
                    val dy = (event.rawY - downY).toInt()
                    if (abs(dx) > touchSlop || abs(dy) > touchSlop) {
                        moved = true
                        mainHandler.removeCallbacks(longPress)
                    }
                    if (moved) {
                        params.x = (startX + dx).coerceIn(0, maxOverlayX(params.width))
                        params.y = (startY + dy).coerceIn(0, maxOverlayY(view.height))
                        runCatching { windowManager.updateViewLayout(view, params) }
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    mainHandler.removeCallbacks(longPress)
                    when {
                        longPressed -> Unit
                        moved -> snapToEdge(view, params)
                        else -> {
                            view.performClick()
                            openDetail()
                        }
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPress)
                    true
                }

                else -> false
            }
        }
    }

    private fun openDetail() {
        val message = currentMessage ?: return
        context.startActivity(
            AlertDetailActivity.createIntent(context, message)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        dismiss()
    }

    private fun snapToEdge(view: View, params: WindowManager.LayoutParams) {
        val maxX = maxOverlayX(params.width)
        params.x = if (params.x < maxX / 2) 0 else maxX
        params.y = params.y.coerceIn(0, maxOverlayY(view.height))
        settingsStore.saveOverlayPosition(params.x, params.y)
        runCatching { windowManager.updateViewLayout(view, params) }
    }

    private fun compactParams(): WindowManager.LayoutParams {
        val width = min(dp(settingsStore.overlayWidthDp), screenWidth() - dp(24))
        val saved = settingsStore.overlayPosition()
        return baseParams(width).apply {
            gravity = Gravity.TOP or Gravity.START
            x = saved?.first?.coerceIn(0, maxOverlayX(width)) ?: maxOverlayX(width)
            y = saved?.second?.coerceIn(0, screenHeight() - dp(72)) ?: dp(96)
        }
    }

    private fun baseParams(width: Int) = WindowManager.LayoutParams(
        width,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        alpha = settingsStore.overlayOpacityPercent / 100f
    }

    private fun levelColor(level: String): Int = ContextCompat.getColor(
        context,
        when (level) {
            "success" -> R.color.success
            "warning" -> R.color.warning
            "error" -> R.color.error
            else -> R.color.info
        },
    )

    private fun maxOverlayX(width: Int): Int = (screenWidth() - width).coerceAtLeast(0)
    private fun maxOverlayY(height: Int): Int = (screenHeight() - height).coerceAtLeast(0)
    private fun screenWidth(): Int = context.resources.displayMetrics.widthPixels
    private fun screenHeight(): Int = context.resources.displayMetrics.heightPixels
    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
