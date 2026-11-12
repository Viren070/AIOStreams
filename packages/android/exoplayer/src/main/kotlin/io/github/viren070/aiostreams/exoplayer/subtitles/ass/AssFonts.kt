package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import io.github.viren070.aiostreams.exoplayer.subtitles.FontFile
import java.io.File

/** The file's fonts, those libass has, and the names each track's styles and lines ask for. */
internal class AssFonts {
    private var fonts: List<FontFile> = emptyList()
    private val given = HashSet<File>()
    private val wanted = HashMap<String, MutableSet<String>>()

    fun clear() {
        fonts = emptyList()
        given.clear()
        wanted.clear()
    }

    fun found(fonts: List<FontFile>) {
        this.fonts = fonts
    }

    fun header(track: String, header: ByteArray) {
        wanted.getOrPut(track) { HashSet() } += styleFonts(header)
    }

    /** True when the line's `\fn` tags name a font the track hadn't asked for. */
    fun line(track: String, line: ByteArray): Boolean = overrideFonts(line, wanted.getOrPut(track) { HashSet() })

    /** The fonts `track` asks for that libass hasn't had yet, counted as had from now. */
    fun take(track: String?): List<FontFile> {
        val names = track?.let(wanted::get) ?: return emptyList()
        val taken = fonts.filter { font -> font.file !in given && font.names?.any(names::contains) != false }
        taken.mapTo(given) { it.file }
        return taken
    }

    private fun styleFonts(header: ByteArray): Set<String> {
        val names = HashSet<String>()
        var styles = false
        var column = 1
        for (raw in String(header, Charsets.UTF_8).lineSequence()) {
            val line = raw.trim()
            when {
                line.startsWith("[") -> styles = line.contains("Styles", ignoreCase = true)
                !styles -> {}
                line.startsWith("Format:") -> column = line.substringAfter(':').split(',')
                    .indexOfFirst { it.trim().equals("Fontname", ignoreCase = true) }.coerceAtLeast(0)
                line.startsWith("Style:") -> line.substringAfter(':').split(',').getOrNull(column)
                    ?.let(::fontKey)?.takeIf { it.isNotEmpty() }?.let(names::add)
            }
        }
        return names
    }

    private fun overrideFonts(line: ByteArray, names: MutableSet<String>): Boolean {
        var added = false
        var i = 0
        while (i + 3 <= line.size) {
            if (line[i] != BACKSLASH || line[i + 1] != 'f'.code.toByte() || line[i + 2] != 'n'.code.toByte()) {
                i++
                continue
            }
            var end = i + 3
            while (end < line.size && line[end] != BACKSLASH && line[end] != '}'.code.toByte()) end++
            val name = fontKey(String(line, i + 3, end - i - 3, Charsets.UTF_8))
            if (name.isNotEmpty() && names.add(name)) added = true
            i = end
        }
        return added
    }

    private companion object {
        const val BACKSLASH = '\\'.code.toByte()
    }
}
