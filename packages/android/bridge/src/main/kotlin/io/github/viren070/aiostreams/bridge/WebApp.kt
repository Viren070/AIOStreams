package io.github.viren070.aiostreams.bridge

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * The bundled web app, served from the APK's `assets/web` at a secure origin,
 * or a dev server's page in its place.
 */
class WebApp(private val devUrl: String?) {
    val startUrl: String = devUrl ?: "$ORIGIN/index.html"

    val origins: Set<String> = setOfNotNull(ORIGIN, devUrl?.let(::originOf))

    /** `chooseFiles` shows the system's picker for a file input, as a WebView doesn't on its own. */
    @SuppressLint("SetJavaScriptEnabled")
    fun configure(webView: WebView, chooseFiles: (multiple: Boolean, picked: ValueCallback<Array<Uri>>) -> Unit) {
        val assets = WebViewAssetLoader.AssetsPathHandler(webView.context)
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/") { path -> assets.handle("web/${path.ifEmpty { "index.html" }}") }
            .build()
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Servers on the local network are often plain http.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            // A pinch or double tap would otherwise zoom the page.
            setSupportZoom(false)
        }
        webView.setBackgroundColor(Color.TRANSPARENT)
        // Kept alive behind other apps, where the page still reports playback.
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                picked: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                chooseFiles(params.mode == FileChooserParams.MODE_OPEN_MULTIPLE, picked)
                return true
            }
        }
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (originOf(request.url.toString()) in origins) return false
                try {
                    view.context.startActivity(
                        Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"

        fun originOf(url: String): String? {
            val uri = Uri.parse(url)
            val scheme = uri.scheme ?: return null
            val host = uri.host ?: return null
            return if (uri.port == -1) "$scheme://$host" else "$scheme://$host:${uri.port}"
        }
    }
}
