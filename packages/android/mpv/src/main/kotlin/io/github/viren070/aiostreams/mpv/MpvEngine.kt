package io.github.viren070.aiostreams.mpv

import android.content.Context
import android.util.Base64
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.MpvProtocol
import `is`.xyz.mpv.MPV
import `is`.xyz.mpv.MPVNode
import java.io.File
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** libmpv, drawing into a surface of its own. */
class MpvEngine(private val context: Context) : Engine {
    private lateinit var mpv: MPV
    // The page's calls wait on mpv, never the main thread.
    private val calls = Executors.newSingleThreadExecutor { Thread(it, "mpv-calls") }
    private var listener: Engine.Listener? = null

    @Volatile
    private var cause: String? = null

    private val dir = File(context.filesDir, "mpv")

    override val description: String
        get() = property("mpv-version") ?: "mpv"

    override fun start(listener: Engine.Listener) {
        this.listener = listener
        dir.mkdirs()
        // mpv's TLS can't read Android's certificate store, so it gets a copy each start.
        writeCertificates(File(dir, CA_BUNDLE))
        fallbackFont(context)
        val options = mapOf(
            "config" to "yes",
            "config-dir" to dir.path,
            "gpu-shader-cache-dir" to context.cacheDir.path,
            "icc-cache-dir" to context.cacheDir.path,
            "vo" to VO,
            "gpu-context" to "android",
            "hwdec" to "mediacodec,mediacodec-copy",
            "tls-verify" to "yes",
            "tls-ca-file" to File(dir, CA_BUNDLE).path,
            "keep-open" to "no",
            "force-window" to "no",
            "input-default-bindings" to "no",
            "input-vo-keyboard" to "no",
            "osc" to "no",
            "osd-bar" to "no",
            "ytdl" to "no",
        )
        mpv = MPV(context) { for ((name, value) in options) it.setOptionString(name, value) }
        // MPV leaves mpv paused, and idling only until its first file ends.
        mpv.setOptionString("idle", "yes")
        mpv.setPropertyBoolean("pause", false)
        mpv.addObserver(observer)
        mpv.addLogObserver(logs)
        for (name in MpvProtocol.observed) mpv.observeProperty(name, formatOf(name))
    }

    override fun command(args: List<String>) = calls.execute { mpv.command(*args.toTypedArray()) }

    override fun setProperty(name: String, value: String) = calls.execute { mpv.setPropertyString(name, value) }

    override fun property(name: String): String? = mpv.getPropertyString(name)

    fun reloadConfig() = command(listOf("load-config-file", configFile(context).path))

    override fun createView(context: Context): View = SurfaceView(context).apply { holder.addCallback(surface) }

    override fun stats(): JsonObject = buildJsonObject {
        put("engine", "mpv")
        for (name in STATS) property(name)?.toLongOrNull()?.let { put(name, it) }
    }

    private val surface = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) = calls.execute {
            mpv.attachSurface(holder.surface)
            mpv.setOptionString("force-window", "yes")
            mpv.setPropertyString("vo", VO)
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) =
            calls.execute { mpv.setPropertyString("android-surface-size", "${width}x$height") }

        // The surface is gone once this returns, so mpv has to let go of it first.
        override fun surfaceDestroyed(holder: SurfaceHolder) {
            val done = CountDownLatch(1)
            calls.execute {
                mpv.setPropertyString("vo", "null")
                mpv.setOptionString("force-window", "no")
                mpv.detachSurface()
                done.countDown()
            }
            done.await(2, TimeUnit.SECONDS)
        }
    }

    override fun release() {
        mpv.removeObserver(observer)
        mpv.removeLogObserver(logs)
        calls.shutdown()
        mpv.close()
    }

    private val observer = object : MPV.EventObserver {
        override fun eventProperty(property: String) = emit(property, JsonNull)

        override fun eventProperty(property: String, value: Long) = emit(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: Boolean) = emit(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: String) = emit(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: Double) = emit(property, JsonPrimitive(value))

        override fun eventProperty(property: String, value: MPVNode) =
            emit(property, runCatching { Json.parseToJsonElement(value.toJson()) }.getOrDefault(JsonNull))

        override fun event(eventId: Int, data: MPVNode) {
            val listener = listener ?: return
            when (eventId) {
                MPV.mpvEvent.MPV_EVENT_START_FILE -> {
                    cause = null
                    listener.onEvent("start-file")
                }
                MPV.mpvEvent.MPV_EVENT_FILE_LOADED -> listener.onEvent("file-loaded")
                MPV.mpvEvent.MPV_EVENT_SEEK -> listener.onEvent("seek")
                MPV.mpvEvent.MPV_EVENT_PLAYBACK_RESTART -> listener.onEvent("playback-restart")
                MPV.mpvEvent.MPV_EVENT_END_FILE -> {
                    val fields = runCatching { data.asMap() }.getOrNull().orEmpty()
                    val error = fields["file_error"]?.asString()
                    listener.onEnded(fields["reason"]?.asString() ?: "unknown", error, cause.takeIf { error != null })
                    cause = null
                }
            }
        }
    }

    private val logs = object : MPV.LogObserver {
        override fun logMessage(prefix: String, level: Int, text: String) {
            val line = text.trimEnd()
            // mpv's error names only the step that failed; FFmpeg's first network error says why.
            if (level <= LOG_ERROR && prefix == "ffmpeg" && cause == null) cause = line.replace(PROTOCOL, "")
            if (level <= LOG_WARN) Log.println(if (level <= LOG_ERROR) Log.ERROR else Log.WARN, TAG, "[$prefix] $line")
        }
    }

    private fun emit(name: String, value: JsonElement) {
        listener?.onProperty(name, value)
    }

    companion object {
        /** The user's own options, which mpv reads at start and on [reloadConfig]. */
        fun configFile(context: Context) = File(File(context.filesDir, "mpv"), "mpv.conf")

        /** The font mpv draws subtitles in where a script's own fonts are missing. */
        fun fallbackFont(context: Context): File =
            File(File(context.filesDir, "mpv").apply { mkdirs() }, FONT).also { copyAsset(context, FONT, it) }

        /** Every certificate Android trusts, the user's own included, as PEM. */
        private fun writeCertificates(target: File) {
            val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
            target.writeText(buildString {
                for (alias in store.aliases()) {
                    val certificate = store.getCertificate(alias) ?: continue
                    append("-----BEGIN CERTIFICATE-----\n")
                    append(Base64.encodeToString(certificate.encoded, Base64.DEFAULT))
                    append("-----END CERTIFICATE-----\n")
                }
            })
        }

        private fun copyAsset(context: Context, name: String, target: File) {
            if (target.exists()) return
            context.assets.open(name).use { input -> target.outputStream().use(input::copyTo) }
        }

        private const val CA_BUNDLE = "cacert.pem"
        private const val FONT = "subfont.ttf"

        private val STATS = listOf("frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count")
        private const val TAG = "mpv"
        private const val VO = "gpu-next"
        private const val LOG_ERROR = 20
        private const val LOG_WARN = 30
        private val PROTOCOL = Regex("^\\w+: ")

        private fun formatOf(name: String): Int = when (name) {
            "pause", "paused-for-cache", "seeking", "idle-active", "mute" -> MPV.mpvFormat.MPV_FORMAT_FLAG
            "aid", "sid" -> MPV.mpvFormat.MPV_FORMAT_STRING
            "track-list", "chapter-list", "video-params" -> MPV.mpvFormat.MPV_FORMAT_NODE
            else -> MPV.mpvFormat.MPV_FORMAT_DOUBLE
        }
    }
}
