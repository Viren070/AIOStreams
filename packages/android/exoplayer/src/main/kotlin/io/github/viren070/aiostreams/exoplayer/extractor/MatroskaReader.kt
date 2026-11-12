package io.github.viren070.aiostreams.exoplayer.extractor

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SeekPoint
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.text.SubtitleTranscodingExtractorOutput
import io.github.viren070.aiostreams.exoplayer.subtitles.Silent
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleCapture
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleSink

/** Where a file's attachments are: their element, or their content when [length] is known. */
internal data class Attachments(val uri: Uri, val position: Long, val length: Long?)

internal interface MatroskaHost {
    /** The subtitle track whose lines a seek reads back for: [ANY_TRACK] until one is picked, or null for none. */
    val readBackTrack: String?

    /** Where the subtitles of the file opening now go. */
    fun subtitles(): SubtitleSink

    /** Bytes the extractor skips unread, which it gets without their being fetched. */
    fun skipping(uri: Uri, position: Long, length: Long)

    fun attachments(found: Attachments)

    companion object {
        const val ANY_TRACK = "*"
    }
}

/**
 * Matroska, read by Media3, with its subtitles taken on the way, before Media3
 * parses them and drops their timing. The player gets no cues for them: the
 * engine times them itself, so its delay applies to them.
 */
@OptIn(UnstableApi::class)
internal class MatroskaReader(private val host: MatroskaHost, private val uri: Uri?) : Extractor {
    private val subtitles = host.subtitles()
    private val matroska = Matroska { position, length -> uri?.let { host.attachments(Attachments(it, position, length)) } }
    private var transcoder: SubtitleTranscodingExtractorOutput? = null

    @Volatile
    private var seekMap: SeekMap? = null

    override fun sniff(input: ExtractorInput) = matroska.sniff(input)

    override fun init(output: ExtractorOutput) {
        val transcoder = SubtitleTranscodingExtractorOutput(output, Silent).also { transcoder = it }
        val seeking = object : ExtractorOutput by transcoder {
            override fun seekMap(seekMap: SeekMap) {
                this@MatroskaReader.seekMap = seekMap
                transcoder.seekMap(ReadBack(seekMap))
            }
        }
        matroska.init(
            seeking
                .filterTracks(C.TRACK_TYPE_VIDEO) { _, track -> SampleDependencies(track) }
                .filterTracks(C.TRACK_TYPE_VIDEO) { id, track -> withFrameRate(track, matroska.frameDurationNs(id)) }
                .filterTracks(C.TRACK_TYPE_TEXT) { _, track -> SubtitleCapture(track, subtitles) },
        )
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = matroska.read(Skips(input), seekPosition)

    override fun seek(position: Long, timeUs: Long) {
        transcoder?.resetSubtitleParsers()
        matroska.seek(position, timeUs)
        // Media3 itself starts at the keyframe's cluster, so starting earlier is a read-back.
        val keyframe = seekMap?.getSeekPoints(timeUs)?.first?.position ?: return
        matroska.readBack(if (position < keyframe) keyframe else -1, host.readBackTrack)
    }

    override fun release() = matroska.release()

    override fun getUnderlyingImplementation(): Extractor = matroska

    private fun withFrameRate(track: TrackOutput, durationNs: Long?): TrackOutput {
        durationNs ?: return track
        return object : TrackOutput by track {
            override fun format(format: Format) = track.format(
                if (format.frameRate > 0) format else format.buildUpon().setFrameRate(1e9f / durationNs).build(),
            )
        }
    }

    private inner class Skips(private val input: ExtractorInput) : ExtractorInput by input {
        override fun skipFully(length: Int) {
            skipping(length)
            input.skipFully(length)
        }

        override fun skipFully(length: Int, allowEndOfInput: Boolean): Boolean {
            skipping(length)
            return input.skipFully(length, allowEndOfInput)
        }

        private fun skipping(length: Int) {
            matroska.skipping(input.position, length.toLong())
            if (length >= LARGE_SKIP) uri?.let { host.skipping(it, input.position, length.toLong()) }
        }
    }

    /** Media3's seek map, starting each seek early enough to read the subtitle lines already showing at its target. */
    private inner class ReadBack(private val map: SeekMap) : SeekMap by map {
        override fun getSeekPoints(timeUs: Long): SeekMap.SeekPoints {
            val points = map.getSeekPoints(timeUs)
            val from = matroska.index.earliest(host.readBackTrack, timeUs)
            if (from == null || from >= points.first.position) return points
            val first = SeekPoint(points.first.timeUs, from)
            return if (points.second == points.first) SeekMap.SeekPoints(first) else SeekMap.SeekPoints(first, points.second)
        }
    }

    private companion object {
        /** Skips the cache serves without fetching. */
        const val LARGE_SKIP = 1 shl 20
    }
}
