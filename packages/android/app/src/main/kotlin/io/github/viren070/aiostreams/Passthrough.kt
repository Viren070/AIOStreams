package io.github.viren070.aiostreams

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.audio.AudioCapabilitiesReceiver
import io.github.viren070.aiostreams.logs.AppLog
import java.util.concurrent.CountDownLatch

/**
 * The Dolby and DTS formats the audio output decodes itself, in mpv's
 * `audio-spdif` names, as ExoPlayer reads them from HDMI and the system.
 */
class Passthrough(context: Context, dropped: () -> Unit, changed: () -> Unit) {
    // Read on the HDMI probe's thread too.
    @Volatile
    private lateinit var capabilities: AudioCapabilities

    // What it decoded before HDMI last dropped formats, which a relink waits to see again.
    @Volatile
    private var before = emptyList<String>()

    // Reading the formats asks the audio service, which can hang for seconds while HDMI links again. On the main
    // thread that holds up the broadcast that tells them, and Android ends an app that doesn't take its broadcasts.
    private val thread = HandlerThread("hdmi-formats").apply { start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private lateinit var receiver: AudioCapabilitiesReceiver

    @Volatile
    private var released = false

    init {
        val registered = CountDownLatch(1)
        worker.post {
            // Built here, it listens on this thread's looper.
            receiver = AudioCapabilitiesReceiver(
                context,
                { next ->
                    val had = supported(ALL)
                    // HDMI linking again drops formats for a moment; the caller waits for them to come back. Told here,
                    // before the new reading shows, so nothing picks tracks for it in between.
                    if (!supportedBy(next, ALL).containsAll(had)) {
                        if (had.containsAll(before)) before = had
                        dropped()
                    }
                    capabilities = next
                    logOutput()
                    main.post { if (!released) changed() }
                },
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                null,
            )
            capabilities = receiver.register()
            registered.countDown()
        }
        // Once, as the app starts, as it was read on the main thread before.
        registered.await()
        logOutput()
    }

    /** In mpv's `audio-spdif` names; DTS-HD falls back to DTS's core. */
    fun supported(wanted: List<String>): List<String> = supportedBy(capabilities, wanted)

    private fun supportedBy(capabilities: AudioCapabilities, wanted: List<String>): List<String> {
        val codecs = SPDIF.filter { (encodings) -> encodings.any(capabilities::supportsEncoding) }.map { it.second }
        return wanted.mapNotNull { name -> name.takeIf { it in codecs } ?: "dts".takeIf { name == "dts-hd" && it in codecs } }
    }

    /** Whether it decodes again all it did before HDMI last dropped formats, which ExoPlayer's tracks go by. */
    fun back() = supported(ALL).containsAll(before)

    /** The output is what it is now, after a wait for formats that didn't come back. */
    fun settle() {
        before = supported(ALL)
    }

    fun release() {
        released = true
        worker.post {
            receiver.unregister()
            thread.quitSafely()
        }
    }

    private fun logOutput() =
        AppLog.i(TAG, "the output decodes ${supported(ALL).joinToString().ifEmpty { "no Dolby or DTS" }}")

    companion object {
        private const val TAG = "audio"
        private val SPDIF = listOf(
            listOf(C.ENCODING_AC3) to "ac3",
            listOf(C.ENCODING_E_AC3, C.ENCODING_E_AC3_JOC) to "eac3",
            listOf(C.ENCODING_DTS) to "dts",
            listOf(C.ENCODING_DTS_HD) to "dts-hd",
            listOf(C.ENCODING_DOLBY_TRUEHD) to "truehd",
        )

        /** Every format it knows, in mpv's names. */
        val ALL = SPDIF.map { it.second }
    }
}
