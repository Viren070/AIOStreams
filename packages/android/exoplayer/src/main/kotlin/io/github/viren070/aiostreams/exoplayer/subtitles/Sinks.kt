package io.github.viren070.aiostreams.exoplayer.subtitles

import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** A font the file carries, on disk, and the names it answers to, null where it couldn't be read. */
internal class FontFile(val file: File, val names: Set<String>?)

/** Where a file's ASS goes as it is read: its fonts, each track's header, and the lines. */
internal interface AssSink {
    fun fonts(fonts: List<FontFile>)

    fun header(track: String, header: ByteArray)

    fun line(track: String, startMs: Long, durationMs: Long, line: ByteArray)
}

/** Where a file's other subtitles go, unparsed, as they are read. */
internal interface TextSink {
    fun track(track: String, parser: SampleParser)

    fun sample(track: String, timeUs: Long, data: ByteArray)
}

internal class SubtitleSink(val ass: AssSink, val text: TextSink)

/** Sends each text track where [drawnByLibass] says it's drawn. */
internal class TextRoute(private val libass: TextSink, private val view: TextSink) : TextSink {
    private val drawn = ConcurrentHashMap.newKeySet<String>()

    override fun track(track: String, parser: SampleParser) {
        if (parser.replace) return view.track(track, parser)
        drawn += track
        libass.track(track, parser)
    }

    override fun sample(track: String, timeUs: Long, data: ByteArray) =
        if (track in drawn) libass.sample(track, timeUs, data) else view.sample(track, timeUs, data)
}
