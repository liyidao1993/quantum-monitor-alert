package com.remix.floatingreceiver.render

import android.content.Context
import android.text.method.LinkMovementMethod
import android.widget.TextView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme

class MarkdownRenderer(context: Context) {
    private val density = context.resources.displayMetrics.density
    private val markwon = Markwon.builder(context)
        .usePlugin(object : AbstractMarkwonPlugin() {
            override fun configureTheme(builder: MarkwonTheme.Builder) {
                builder
                    .blockMargin(dp(10))
                    .headingBreakHeight(0)
                    .headingTextSizeMultipliers(floatArrayOf(1.10f, 1.06f, 1.03f, 1f, 1f, 1f))
            }
        })
        .usePlugin(
            TablePlugin.create(
                TableTheme.buildWithDefaults(context)
                    .tableCellPadding(dp(2))
                    .build(),
            ),
        )
        .build()

    fun render(target: TextView, markdown: String) {
        target.movementMethod = LinkMovementMethod.getInstance()
        markwon.setMarkdown(target, markdown)
    }

    private fun dp(value: Int): Int = (value * density).toInt()
}
