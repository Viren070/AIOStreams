package io.github.viren070.aiostreams

import io.github.viren070.aiostreams.logs.AppLog
import java.util.concurrent.Executors
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A YouTube video's stream for a trailer, asked as the desktop app's `core/src/youtube.rs` asks. */
class YouTube(private val send: (JsonObject) -> Unit) {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "youtube") }
    private val client = OkHttpClient()

    private class Client(
        val name: String,
        val id: String,
        val version: String,
        val userAgent: String,
        val key: String?,
        val fields: Map<String, String>,
        val hls: Boolean,
    )

    private class Stream(val url: String, val originalLanguage: String?)

    fun resolve(request: String, videoId: String) = worker.execute {
        val stream = if (VIDEO_ID.matches(videoId)) {
            CLIENTS.firstNotNullOfOrNull { runCatching { ask(it, videoId) }.onFailure { e -> AppLog.w(TAG, it.name, e) }.getOrNull() }
        } else {
            null
        }
        send(buildJsonObject {
            put("type", "youtube-resolved")
            put("request", request)
            put("url", stream?.url)
            stream?.originalLanguage?.let { put("originalLanguage", it) }
        })
    }

    fun release() = worker.shutdownNow()

    private fun ask(client: Client, videoId: String): Stream? {
        var visitor: String? = null
        repeat(2) {
            val answer = player(client, videoId, visitor)
            val ok = answer["playabilityStatus"]?.jsonObject?.get("status")?.jsonPrimitive?.contentOrNull == "OK"
            val streaming = answer["streamingData"]?.jsonObject
            if (ok && streaming != null) {
                val url = if (client.hls) {
                    streaming["hlsManifestUrl"]?.jsonPrimitive?.contentOrNull
                } else {
                    (streaming["formats"] as? JsonArray)?.firstNotNullOfOrNull {
                        it.jsonObject["url"]?.jsonPrimitive?.contentOrNull
                    }
                }
                return url?.let { Stream(it, originalLanguage(streaming)) }
            }
            visitor = answer["responseContext"]?.jsonObject?.get("visitorData")?.jsonPrimitive?.contentOrNull ?: return null
        }
        return null
    }

    /** The original audio's language, which a manifest with dubs doesn't mark. */
    private fun originalLanguage(streaming: JsonObject): String? =
        (streaming["adaptiveFormats"] as? JsonArray)?.firstNotNullOfOrNull { format ->
            val track = (format as? JsonObject)?.get("audioTrack") as? JsonObject
            // Such as `en-US.4`.
            track?.takeIf { it["audioIsDefault"]?.jsonPrimitive?.booleanOrNull == true }
                ?.get("id")?.jsonPrimitive?.contentOrNull?.substringBefore('.')
        }

    private fun player(client: Client, videoId: String, visitor: String?): JsonObject {
        val body = buildJsonObject {
            put("videoId", videoId)
            putJsonObject("context") {
                putJsonObject("client") {
                    put("clientName", client.name)
                    put("clientVersion", client.version)
                    put("hl", "en")
                    put("gl", "US")
                    visitor?.let { put("visitorData", it) }
                    for ((name, value) in client.fields) put(name, value)
                }
            }
            put("contentCheckOk", true)
            put("racyCheckOk", true)
        }
        val url = "https://www.youtube.com/youtubei/v1/player?" +
            (client.key?.let { "key=$it&" } ?: "") + "prettyPrint=false"
        val request = Request.Builder().url(url)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("User-Agent", client.userAgent)
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com/")
            .header("X-YouTube-Client-Name", client.id)
            .header("X-YouTube-Client-Version", client.version)
            .apply { visitor?.let { header("X-Goog-Visitor-Id", it) } }
            .build()
        return this.client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code}" }
            Json.parseToJsonElement(response.body.string()).jsonObject
        }
    }

    private companion object {
        const val TAG = "youtube"
        val VIDEO_ID = Regex("[A-Za-z0-9_-]{11}")

        val CLIENTS = listOf(
            Client(
                name = "VISIONOS",
                id = "101",
                version = "1.02",
                userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                key = null,
                fields = mapOf(
                    "deviceMake" to "Apple",
                    "deviceModel" to "RealityDevice17,1",
                    "osName" to "visionOS",
                    "osVersion" to "26.5.23O471",
                ),
                hls = true,
            ),
            Client(
                name = "ANDROID",
                id = "3",
                version = "20.10.41",
                userAgent = "com.google.android.youtube/20.10.41 (Linux; U; Android 11) gzip",
                key = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
                fields = mapOf(
                    "deviceMake" to "Google",
                    "deviceModel" to "Pixel 5",
                    "osName" to "Android",
                    "osVersion" to "11",
                    "androidSdkVersion" to "30",
                    "platform" to "MOBILE",
                ),
                hls = false,
            ),
        )
    }
}
