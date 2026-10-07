package io.github.viren070.aiostreams.bridge

import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Whatever the page reads from `window.aiostreamsApp` as it starts. */
data class AppIdentity(val version: String, val device: String, val deviceId: String)

/**
 * The page's `window.aiostreamsApp`, the desktop app's protocol carried by a
 * web message listener. Only pages from [origins] get it.
 */
class AppBridge(
    webView: WebView,
    origins: Set<String>,
    identity: AppIdentity,
    private val onMessage: (type: String, message: JsonObject) -> Unit,
) {
    private var reply: JavaScriptReplyProxy? = null

    init {
        check(
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) { "This WebView is too old to host the app" }
        WebViewCompat.addWebMessageListener(webView, PORT, origins) { _, message, _, isMainFrame, replyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            // A page that loads again brings a new proxy, announced by its first message.
            reply = replyProxy
            val json = message.data
                ?.let { runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull() }
                ?: return@addWebMessageListener
            val type = json["type"]?.jsonPrimitive?.content ?: return@addWebMessageListener
            if (type != HELLO) onMessage(type, json)
        }
        WebViewCompat.addDocumentStartJavaScript(webView, script(identity), origins)
    }

    /** On the main thread only. */
    /** Whether a page is listening. */
    val connected: Boolean
        get() = reply != null

    fun send(message: JsonObject) {
        reply?.postMessage(message.toString())
    }

    private fun script(identity: AppIdentity): String = """
        (() => {
          if (window.top !== window || window.aiostreamsApp) return;
          const port = window.$PORT;
          if (!port) return;
          const listeners = new Set();
          port.onmessage = (event) => {
            let message;
            try {
              message = JSON.parse(event.data);
            } catch {
              return;
            }
            for (const listener of listeners) {
              try {
                listener(message);
              } catch (error) {
                console.error(error);
              }
            }
          };
          const send = (message) => port.postMessage(JSON.stringify(message));
          window.aiostreamsApp = Object.freeze({
            protocol: 1,
            version: ${JsonPrimitive(identity.version)},
            platform: 'android',
            device: ${JsonPrimitive(identity.device)},
            deviceId: ${JsonPrimitive(identity.deviceId)},
            send,
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          });
          send({ type: '$HELLO' });
        })();
    """.trimIndent()

    private companion object {
        const val PORT = "aiostreamsNative"
        const val HELLO = "hello"
    }
}
