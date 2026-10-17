package io.github.viren070.aiostreams

import android.content.Context
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.WebSettings
import android.widget.TextView
import io.github.viren070.aiostreams.bridge.AppBridge

/** The web app's layouts need `lh` (Chromium 109), `dvh` (108) and `:has()` (105), none with a fallback. */
private const val MIN_CHROMIUM = 109

private fun chromium(context: Context): Int? =
    Regex("""Chrome/(\d+)""").find(WebSettings.getDefaultUserAgent(context))?.groupValues?.get(1)?.toIntOrNull()

/** False on a WebView too old for the bridge or the page, as Android 7 to 9 may still ship. */
fun webViewUsable(context: Context): Boolean =
    AppBridge.supported() && (chromium(context) ?: MIN_CHROMIUM) >= MIN_CHROMIUM

fun outdatedWebView(context: Context): View {
    val version = chromium(context)?.toString() ?: context.getString(R.string.webview_version_unknown)
    val padding = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 32f, context.resources.displayMetrics).toInt()
    return TextView(context).apply {
        text = context.getString(R.string.webview_too_old, version, MIN_CHROMIUM) + "\n\n" +
            context.getString(R.string.webview_update)
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setPadding(padding, padding, padding, padding)
    }
}
