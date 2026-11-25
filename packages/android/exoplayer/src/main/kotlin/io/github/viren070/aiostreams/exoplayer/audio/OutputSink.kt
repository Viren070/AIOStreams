package io.github.viren070.aiostreams.exoplayer.audio

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioSink.AudioSinkConfig
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import io.github.viren070.aiostreams.logs.AppLog
import java.nio.ByteBuffer

/** Passes through only the formats the page allows, and delays the sound against the picture. */
@OptIn(UnstableApi::class)
internal class OutputSink(sink: AudioSink) : ForwardingAudioSink(sink) {
    /** The sample types passed through, from mpv's `audio-spdif` list. */
    @Volatile
    var passthrough: Set<String> = emptySet()
        private set

    @Volatile
    var delayUs = 0L

    @Volatile
    private var listener: AudioSink.Listener? = null

    /** Told, on the player's thread, when the sound is held for an output that broke. */
    @Volatile
    var broke: () -> Unit = {}

    /** Whether the output can take the sound again: HDMI passes through steadily once more. */
    @Volatile
    var canResume: () -> Boolean = { true }

    /** Whether the hold waits for the app to come back, which no time limit ends. */
    @Volatile
    var waits: () -> Boolean = { false }

    /**
     * Whether a paused file's sound waits to be written: HDMI links again, or the app is away. A track written to then
     * breaks, and the sound in it is lost; held back, the sound starts where the picture stands.
     */
    @Volatile
    var quiet: () -> Boolean = { false }

    /** Whether the file is paused, which starts sound and picture together on play without a seek. */
    @Volatile
    var paused: () -> Boolean = { false }

    /** Asked, on the player's thread, to start sound and picture together again where the sound stopped. */
    @Volatile
    var resume: () -> Unit = {}

    /** Told, on the player's thread, when the output takes sound again after breaking. */
    @Volatile
    var recovered: () -> Unit = {}

    /** Told before the sink asks for tracks to be picked again for a change of its own, the page's or the speed's. */
    @Volatile
    var repicking: () -> Unit = {}

    private fun repick() {
        repicking()
        listener?.onAudioCapabilitiesChanged()
    }

    // HDMI linking again breaks the audio track for a while: the sound waits, the picture with it on its clock,
    // and neither starts before the other. Nothing is written meanwhile, so no sound is lost or skipped.
    private var heldSince = 0L
    private var held: Exception? = null
    private var resumeAsked = false

    // Breaks since the output last took sound for a while: one that never works goes to the player as an error after a
    // few. A wrapper can accept a buffer without writing anything (the AC-3 encoder gathering a frame), so a single
    // accepted buffer doesn't count as working.
    private var breaks = 0
    private var tookSince = 0L

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (heldSince != 0L) return waitToResume()
        if (quiet()) {
            heldBack = true
            return false
        }
        return try {
            super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount).also {
                if (it) {
                    heldBack = false
                    tookSound()
                }
            }
        } catch (e: AudioSink.WriteException) {
            hold(e)
        } catch (e: AudioSink.InitializationException) {
            hold(e)
        }
    }

    private fun tookSound() {
        if (breaks == 0) return
        val now = SystemClock.uptimeMillis()
        if (tookSince == 0L) tookSince = now
        if (now - tookSince < WORKING_MS) return
        breaks = 0
        tookSince = 0L
        recovered()
    }

    private fun hold(error: Exception): Boolean {
        // Before the give-up too: a stretch of sound from before the break must not count after a re-prepare.
        tookSince = 0L
        // Breaks while HDMI is known to link again, or the app is away, are no sign of an output that never works.
        if (canResume() && ++breaks > MAX_BREAKS) {
            AppLog.i(TAG, "the audio output broke again, $breaks times without taking sound; giving up the wait")
            throw error
        }
        heldSince = SystemClock.uptimeMillis()
        held = error
        resumeAsked = false
        AppLog.i(TAG, "the audio output broke (${error.message}); holding sound and picture until it takes them again")
        // Lets go of the dead track.
        super.flush()
        broke()
        return false
    }

    private fun waitToResume(): Boolean {
        if (waits()) {
            heldSince = SystemClock.uptimeMillis()
            return false
        }
        val waited = SystemClock.uptimeMillis() - heldSince
        if (waited > MAX_HOLD_MS) {
            heldSince = 0L
            throw held ?: IllegalStateException("the audio output didn't come back")
        }
        if (resumeAsked || waited < MIN_HOLD_MS || !canResume()) return false
        if (paused()) {
            // No seek while the picture shows: the sound starts again from here once played.
            heldSince = 0L
            held = null
            AppLog.i(TAG, "the audio output is back after $waited ms; the paused file plays on from here")
            return false
        }
        resumeAsked = true
        AppLog.i(TAG, "the audio output is back after $waited ms; starting sound and picture together")
        // A seek to where the sound stopped flushes both, and both start from there.
        resume()
        return false
    }

    override fun flush() {
        heldBack = false
        // Sound from before a seek is no proof the output works now.
        tookSince = 0L
        // A seek while the app is away keeps the hold: nothing opens a track until it comes back.
        if (heldSince != 0L && waits()) {
            resumeAsked = false
            super.flush()
            return
        }
        heldSince = 0L
        held = null
        resumeAsked = false
        super.flush()
    }

    // Media3 counts a paused file as loading while its sink holds no sound (MediaCodecAudioRenderer.isReady in 1.11.1),
    // and the page shows a spinner over the still picture. Held back on purpose, the paused file is ready.
    override fun hasPendingData(): Boolean {
        if (super.hasPendingData()) return true
        if (paused() && (heldSince != 0L || quiet())) return true
        if (!heldBack) return false
        // Held back until a moment ago (HDMI settled, or Play came): ready until the first write, which takes
        // a moment, not a spinner over the picture for it. Only briefly once played: the sound's clock waits there.
        if (paused()) {
            // Paused again before the first write: the next Play gets its moment again.
            heldBackPlayedAt = 0L
            return true
        }
        val now = SystemClock.uptimeMillis()
        if (heldBackPlayedAt == 0L) heldBackPlayedAt = now
        return now - heldBackPlayedAt < HELD_BACK_PLAY_MS
    }

    // Sound held back on purpose and not written since, and when the file was played with it so.
    @Volatile
    private var heldBack = false
        set(value) {
            field = value
            heldBackPlayedAt = 0L
        }

    @Volatile
    private var heldBackPlayedAt = 0L

    override fun setListener(listener: AudioSink.Listener) {
        this.listener = listener
        super.setListener(listener)
    }

    fun setSpdif(names: List<String>) {
        val next = names.flatMapTo(mutableSetOf()) { SPDIF[it].orEmpty() }
        if (next == passthrough) return
        passthrough = next
        AppLog.i(TAG, "passthrough allowed: ${names.joinToString().ifEmpty { "none" }}")
        // Picks the track's output again, so a changed setting applies at once.
        repick()
    }

    private var stretching = false
    /** Whether the track plays out as it is, not decoded. */
    @Volatile
    var passingThrough = false
        private set
    private var decodedForSpeed = false
    private var output: String? = null

    override fun configure(audioSinkConfig: AudioSinkConfig) {
        val format = audioSinkConfig.format
        passingThrough = format.sampleMimeType != MimeTypes.AUDIO_RAW
        val next = "${format.sampleMimeType} ${format.channelCount} ch ${format.sampleRate} Hz, " +
            if (passingThrough) "passed through" else "decoded"
        if (next != output) AppLog.i(TAG, "audio output: $next")
        output = next
        super.configure(audioSinkConfig)
    }

    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {
        super.setPlaybackParameters(playbackParameters)
        val next = playbackParameters.speed != 1f
        if (next == stretching) return
        stretching = next
        // Picking again seeks the file.
        if (if (next) passingThrough else decodedForSpeed) {
            decodedForSpeed = false
            repick()
        }
    }

    /** Sound the output would take as it is, which the app decodes instead while the speed isn't normal: encoded sound can't change speed. */
    fun decodesForSpeed(format: Format) =
        (stretching && format.sampleMimeType in passthrough && super.supportsFormat(format)).also { if (it) decodedForSpeed = true }

    private fun allowed(format: Format) = format.sampleMimeType == MimeTypes.AUDIO_RAW || format.sampleMimeType in passthrough

    override fun supportsFormat(format: Format) = allowed(format) && super.supportsFormat(format)

    override fun getFormatSupport(format: Format) =
        if (allowed(format)) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED

    // The video follows this clock: running it ahead shows each frame sooner than its sound.
    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        val position = super.getCurrentPositionUs(sourceEnded)
        return if (position == AudioSink.CURRENT_POSITION_NOT_SET) position else position + delayUs
    }

    private companion object {
        const val TAG = "audio"
        const val MIN_HOLD_MS = 500L
        const val MAX_HOLD_MS = 15_000L
        const val MAX_BREAKS = 3
        const val WORKING_MS = 2_000L
        const val HELD_BACK_PLAY_MS = 500L
        val SPDIF = mapOf(
            "ac3" to listOf(MimeTypes.AUDIO_AC3),
            "eac3" to listOf(MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC),
            "dts" to listOf(MimeTypes.AUDIO_DTS),
            "dts-hd" to listOf(MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_X),
            "truehd" to listOf(MimeTypes.AUDIO_TRUEHD),
        )
    }
}
