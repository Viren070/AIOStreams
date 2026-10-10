package io.github.viren070.aiostreams.exoplayer

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.SubtitleParser

/**
 * Media3's extractors, with Matroska's sending its subtitles to the file's
 * [SubtitleSink], and every one's Dolby Vision tracks routed for the device.
 */
@OptIn(UnstableApi::class)
internal class Extractors(
    /** The subtitle track whose lines a seek reads back for, or [ANY_TRACK] before the engine picks one. */
    private val readBack: () -> String?,
    private val sink: () -> SubtitleSink,
    private val route: (Int) -> DolbyVisionRoute,
    private val onRoute: (codecs: String, DolbyVisionRoute) -> Unit,
) : ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()

    override fun createExtractors() = wrapped(defaults.createExtractors())

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>) =
        wrapped(defaults.createExtractors(uri, responseHeaders))

    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory) = apply {
        defaults.setSubtitleParserFactory(subtitleParserFactory)
    }

    @Deprecated("Media3's own, kept as it forwards")
    @Suppress("DEPRECATION")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean) = apply {
        defaults.setTextTrackTranscodingEnabled(textTrackTranscodingEnabled)
    }

    private fun wrapped(extractors: Array<Extractor>) = extractors.map {
        DolbyVisionExtractor(if (it is MatroskaExtractor) MatroskaReader(sink(), readBack) else it, route, onRoute)
    }.toTypedArray()

    companion object {
        const val ANY_TRACK = "*"
    }
}
