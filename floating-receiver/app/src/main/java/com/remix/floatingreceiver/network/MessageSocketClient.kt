package com.remix.floatingreceiver.network

import android.os.Handler
import android.os.Looper
import com.remix.floatingreceiver.model.ReceivedMessage
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

class MessageSocketClient(private val listener: Listener) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .pingInterval(45, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var endpoint = ""
    private var token = ""
    private var lastSequence = 0L
    private var webSocket: WebSocket? = null
    private var stopped = true
    private var generation = 0
    private var retryIndex = 0
    private var reconnectPending = false

    fun start(endpoint: String, token: String, lastSequence: Long) {
        this.endpoint = endpoint
        this.token = token
        this.lastSequence = lastSequence
        stopped = false
        retryIndex = 0
        connectNow()
    }

    fun acknowledge(sequence: Long) {
        if (sequence > lastSequence) lastSequence = sequence
    }

    fun stop() {
        stopped = true
        generation += 1
        reconnectPending = false
        mainHandler.removeCallbacksAndMessages(null)
        webSocket?.close(1000, "Service stopped")
        webSocket = null
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    private fun connectNow() {
        if (stopped) return
        reconnectPending = false
        listener.onStateChanged(State.CONNECTING)

        val httpEndpoint = endpoint
            .replaceFirst("wss://", "https://")
            .replaceFirst("ws://", "http://")
        val url = httpEndpoint.toHttpUrlOrNull()
            ?.newBuilder()
            ?.setQueryParameter("after", lastSequence.toString())
            ?.build()
        if (url == null) {
            listener.onStateChanged(State.DISCONNECTED)
            scheduleReconnect()
            return
        }

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .build()
        val connectionGeneration = ++generation
        webSocket = client.newWebSocket(request, socketListener(connectionGeneration))
    }

    private fun socketListener(connectionGeneration: Int) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            mainHandler.post {
                if (!isCurrent(connectionGeneration)) return@post
                retryIndex = 0
                listener.onStateChanged(State.CONNECTED)
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = ReceivedMessage.fromJson(text)
            mainHandler.post {
                if (!isCurrent(connectionGeneration)) return@post
                if (message == null) {
                    listener.onInvalidMessage()
                } else if (message.sequence > lastSequence) {
                    listener.onMessage(message)
                }
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            mainHandler.post {
                if (!isCurrent(connectionGeneration)) return@post
                listener.onStateChanged(State.DISCONNECTED)
                scheduleReconnect()
            }
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
            mainHandler.post {
                if (!isCurrent(connectionGeneration)) return@post
                listener.onStateChanged(State.DISCONNECTED)
                scheduleReconnect()
            }
        }
    }

    private fun scheduleReconnect() {
        if (stopped || reconnectPending) return
        reconnectPending = true
        val delay = RETRY_DELAYS[retryIndex.coerceAtMost(RETRY_DELAYS.lastIndex)]
        retryIndex = (retryIndex + 1).coerceAtMost(RETRY_DELAYS.lastIndex)
        mainHandler.postDelayed({ connectNow() }, delay)
    }

    private fun isCurrent(connectionGeneration: Int): Boolean =
        !stopped && generation == connectionGeneration

    interface Listener {
        fun onStateChanged(state: State)
        fun onMessage(message: ReceivedMessage)
        fun onInvalidMessage()
    }

    enum class State { CONNECTING, CONNECTED, DISCONNECTED }

    companion object {
        private val RETRY_DELAYS = longArrayOf(2_000, 5_000, 15_000, 30_000, 60_000)
    }
}
