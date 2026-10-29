package io.github.viren070.aiostreams.exoplayer.subtitles

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.SubtitleParser
import io.github.viren070.aiostreams.exoplayer.subtitles.ass.AssText
import io.github.viren070.aiostreams.playback.PlayerTrack

/** A subtitle file as an ASS script: the file's own, or SubRip or WebVTT made one. */
internal class SubtitleScript private constructor(val codec: String, val bytes: ByteArray) {
    /** Made from text rather than the file's own ASS. */
    val converted get() = codec != "ass"

    @OptIn(UnstableApi::class)
    companion object {
        fun read(file: ByteArray): SubtitleScript {
            val text = String(file, Charsets.UTF_8).trimStart(BOM, ' ', '\r', '\n')
            if (text.startsWith("[Script Info]", ignoreCase = true)) return SubtitleScript("ass", file)
            val vtt = text.startsWith("WEBVTT")
            val format = Format.Builder().setSampleMimeType(if (vtt) MimeTypes.TEXT_VTT else MimeTypes.APPLICATION_SUBRIP).build()
            val lines = mutableListOf<CuesWithTiming>()
            subtitleParsers.create(format).parse(file, SubtitleParser.OutputOptions.allCues()) { lines += it }
            return SubtitleScript(if (vtt) "webvtt" else "subrip", AssText.script(lines))
        }

        private val BOM = Char(0xFEFF)
    }
}

/** A subtitle file the page added, which libass draws rather than the video reloading. */
internal class ExternalSubtitle(
    val id: Int,
    val url: String,
    private val title: String?,
    private val language: String?,
    val script: SubtitleScript,
) {
    /** What libass knows the script as. */
    val key = "+$id"

    fun track() = PlayerTrack(
        id = id.toString(),
        type = "subtitle",
        title = title,
        language = language,
        codec = script.codec,
        external = true,
        url = url,
    )
}
