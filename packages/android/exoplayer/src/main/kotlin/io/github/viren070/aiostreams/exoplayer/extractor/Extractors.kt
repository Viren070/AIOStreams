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
import io.github.viren070.aiostreams.exoplayer.video.DolbyVisionRouter
import io.github.viren070.aiostreams.exoplayer.video.DolbyVisionTrack

/** What the extractors reading the engine's file ask of it and tell it, on the loader's thread. */
internal interface ExtractorHost : MatroskaHost, DolbyVisionRouter {
    fun seekMap(map: SeekMap)

    fun videoFrame(timeUs: Long)
}

/** Media3's extractors, with Matroska's read by [MatroskaReader] and every one's tracks and seek map told to [host]. */
@OptIn(UnstableApi::class)
internal class Extractors(private val host: ExtractorHost) : ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()

    override fun createExtractors() = tapped(defaults.createExtractors(), null)

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>) =
        tapped(defaults.createExtractors(uri, responseHeaders), uri)

    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory) = apply {
        defaults.setSubtitleParserFactory(subtitleParserFactory)
    }

    @Deprecated("Media3's own, kept as it forwards")
    @Suppress("DEPRECATION")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean) = apply {
        defaults.setTextTrackTranscodingEnabled(textTrackTranscodingEnabled)
    }

    private fun tapped(extractors: Array<Extractor>, uri: Uri?) = Array<Extractor>(extractors.size) { i ->
        val extractor = extractors[i]
        Tapped(if (extractor is MatroskaExtractor) MatroskaReader(host, uri) else extractor, host)
    }
}

@OptIn(UnstableApi::class)
private class Tapped(private val extractor: Extractor, private val host: ExtractorHost) : Extractor by extractor {
    override fun init(output: ExtractorOutput) {
        val told = object : ExtractorOutput by output {
            override fun seekMap(seekMap: SeekMap) {
                host.seekMap(seekMap)
                output.seekMap(seekMap)
            }
        }
        extractor.init(told.filterTracks(C.TRACK_TYPE_VIDEO) { _, track -> DolbyVisionTrack(FrameTimes(track), host) })
    }

    override fun getUnderlyingImplementation(): Extractor = extractor.underlyingImplementation

    private inner class FrameTimes(private val track: TrackOutput) : TrackOutput by track {
        override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
            host.videoFrame(timeUs)
            track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
        }
    }
}
