package io.github.viren070.aiostreams.mpv

import android.util.Log
import io.github.viren070.aiostreams.playback.Sound
import `is`.xyz.mpv.MPV
import `is`.xyz.mpv.MPVNode
import java.util.Locale
import kotlin.math.pow

/**
 * The page's sound settings that mpv has no option for, as labelled audio
 * filters around a user's own `af`. Kept in step with what mpv decodes.
 */
internal class SoundFilters(private val mpv: MPV) {
    private var layout: Pair<String, Int>? = null
    private var graph: String? = null
    private var ac3 = false

    /** The output refused the encoder's AC-3 in this file. */
    private var refused = false

    /** The last file's filters may not fit this one's sound. */
    fun startFile() {
        layout = null
        refused = false
    }

    /** From the audio track, so the filters are in before the sound starts; null where it passes through. */
    fun loaded() {
        val track = mpv.getPropertyNode("current-tracks/audio")
        val codec = track?.get("codec")?.asString()
        val passes = spdif().any { it == codec || (codec == "dts" && it == "dts-hd") }
        layout = layoutOf(track?.get("demux-channels")?.asString(), track?.get("demux-channel-count")?.asInt()).takeIf { !passes }
    }

    /** From `audio-params`, which says what mpv decodes once it starts. */
    fun decoded(params: MPVNode?) {
        val format = params?.get("format")?.asString()
        layout = layoutOf(params?.get("channels")?.asString(), params?.get("channel-count")?.asInt())
            .takeIf { format != null && !format.startsWith("spdif") }
    }

    /** Whether mpv's log says the output refused the encoder's AC-3, which then stops for the file. */
    fun refused(prefix: String, text: String): Boolean {
        if (!ac3 || prefix != "cplayer" || !text.startsWith(REFUSED)) return false
        Log.w(TAG, "the output refused AC-3, so this file plays without encoding")
        refused = true
        return true
    }

    fun apply(sound: Sound) {
        val layout = layout
        val graph = layout?.let { (channels, count) -> graphOf(sound, channels, count) }
        val ac3 = layout != null && layout.second > 2 && sound.ac3Encode && !refused && "ac3" in spdif()
        if (graph != this.graph) {
            if (this.graph != null) edit("remove", SOUND_FILTER)
            // First, so the user's own filters and the encoder come after it.
            if (graph != null) edit("pre", "$SOUND_FILTER:$graph")
            this.graph = graph
        }
        if (ac3 != this.ac3) {
            if (ac3) edit("add", "$AC3_FILTER:lavcac3enc") else edit("remove", AC3_FILTER)
            this.ac3 = ac3
        }
    }

    private fun spdif() = mpv.getPropertyString("audio-spdif")?.split(',').orEmpty()

    /** mpv logs a filter that fails. */
    private fun edit(operation: String, filter: String) {
        Log.i(TAG, "af $operation $filter")
        mpv.command("af", operation, filter)
    }

    private companion object {
        const val TAG = "mpv"
        const val SOUND_FILTER = "@aiostreams-sound"
        const val AC3_FILTER = "@aiostreams-ac3"

        /** mpv's error for an output that won't take what passes through, the encoder's AC-3 included. */
        const val REFUSED = "Passthrough format unsupported"
        const val COMPRESSOR = "acompressor=threshold=0.063:ratio=6:attack=5:release=300:makeup=4"

        /** Catches what the boosts push past full scale. */
        const val LIMITER = "alimiter=limit=0.891:level=disabled"

        /** FFmpeg's layouts with a centre channel, which each have it third. */
        val CENTRED = setOf(
            "3.0", "3.1", "4.0", "4.1", "5.0", "5.0(side)", "5.1", "5.1(side)", "6.0", "hexagonal",
            "6.1", "6.1(back)", "7.0", "7.0(front)", "7.1", "7.1(wide)", "7.1(wide-side)", "7.1(top)", "octagonal",
        )

        fun layoutOf(channels: String?, count: Long?) = if (channels == null || count == null) null else channels to count.toInt()

        fun graphOf(sound: Sound, channels: String, count: Int): String? {
            val filters = listOfNotNull(
                centreBoost(channels, count, sound.dialogueBoost)?.let { "pan=$it" },
                COMPRESSOR.takeIf { sound.nightMode },
            )
            return if (filters.isEmpty()) null else "lavfi=[${(filters + LIMITER).joinToString(",")}]"
        }

        /** `pan` raising the centre channel, where the layout has one beside the front pair. */
        fun centreBoost(channels: String, count: Int, db: Int): String? {
            if (db <= 0) return null
            val layout = when {
                channels in CENTRED -> channels
                channels.startsWith("fl-fr-fc-") -> channels.split('-').joinToString("+") { it.uppercase(Locale.ROOT) }
                else -> return null
            }
            val gain = "%.3f".format(Locale.ROOT, 10.0.pow(db / 20.0))
            return (listOf(layout) + (0 until count).map { if (it == 2) "c2=$gain*c2" else "c$it=c$it" }).joinToString("|")
        }
    }
}
