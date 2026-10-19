package io.github.viren070.aiostreams.natives

/** When the lines of a file's own subtitles show, read from the file's index without playing it. */
object SubtitleTimeline {
    init {
        System.loadLibrary("aiostreams_native")
    }

    /**
     * `{"tracks": [{number, codec, language, lines: [[startMs, endMs]]}]}` with the file's subtitle
     * tracks in order, or `{"error": ...}`. `headers` alternates names and values; `caPem` is the
     * device's trusted roots as PEM. Blocks for up to about seven seconds.
     */
    @JvmStatic
    external fun read(url: String, headers: Array<String>, caPem: ByteArray?): String
}
