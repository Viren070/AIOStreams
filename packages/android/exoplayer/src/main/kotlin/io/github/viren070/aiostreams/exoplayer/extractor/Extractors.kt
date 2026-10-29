package io.github.viren070.aiostreams.exoplayer.extractor

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.SubtitleParser
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleSink
import io.github.viren070.aiostreams.exoplayer.video.DolbyVisionExtractor
import io.github.viren070.aiostreams.exoplayer.video.DolbyVisionRoute
import io.github.viren070.aiostreams.exoplayer.video.VideoFrames

/**
 * Media3's extractors, with Matroska's sending its subtitles to the file's
 * [SubtitleSink] and its skips and attachments to [events], every one's Dolby
 * Vision tracks routed for the device, and its seek map told to [onSeekMap].
 */
@OptIn(UnstableApi::class)
internal class Extractors(
    /** The subtitle track whose lines a seek reads back for, or [ANY_TRACK] before the engine picks one. */
    private val readBack: () -> String?,
    private val sink: () -> SubtitleSink,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
    private val onSeekMap: (SeekMap) -> Unit,
    private val events: MatroskaEvents,
    private val frames: VideoFrames,
) : ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()

    override fun createExtractors() = wrapped(defaults.createExtractors(), null)

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>) =
        wrapped(defaults.createExtractors(uri, responseHeaders), uri)

    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory) = apply {
        defaults.setSubtitleParserFactory(subtitleParserFactory)
    }

    @Deprecated("Media3's own, kept as it forwards")
    @Suppress("DEPRECATION")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean) = apply {
        defaults.setTextTrackTranscodingEnabled(textTrackTranscodingEnabled)
    }

    private fun wrapped(extractors: Array<Extractor>, uri: Uri?) = extractors.map<Extractor, Extractor> {
        val reader = if (it is MatroskaExtractor) MatroskaReader(sink(), readBack, uri, events) else it
        Tap(DolbyVisionExtractor(reader, route, onRoute), onSeekMap, frames)
    }.toTypedArray()

    companion object {
        const val ANY_TRACK = "*"
    }
}

/** Tells [onSeekMap] the extractor's seek map and [frames] its video frames' times. */
@OptIn(UnstableApi::class)
private class Tap(
    private val extractor: Extractor,
    private val onSeekMap: (SeekMap) -> Unit,
    private val frames: VideoFrames,
) : Extractor by extractor {
    override fun init(output: ExtractorOutput) = extractor.init(
        object : ExtractorOutput by output {
            override fun seekMap(seekMap: SeekMap) {
                onSeekMap(seekMap)
                output.seekMap(seekMap)
            }

            override fun track(id: Int, type: Int): TrackOutput {
                val track = output.track(id, type)
                if (type != C.TRACK_TYPE_VIDEO) return track
                return object : TrackOutput by track {
                    override fun sampleMetadata(
                        timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?,
                    ) {
                        frames.add(timeUs)
                        track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
                    }
                }
            }
        },
    )

    override fun getUnderlyingImplementation(): Extractor = extractor.underlyingImplementation
}
