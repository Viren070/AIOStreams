package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException

/** The playlist or manifest type of an address that doesn't say, from what its server sends. */
@OptIn(UnstableApi::class)
internal object ManifestType {
    private const val PEEK_BYTES = 2048
    private val HLS_TYPES = setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl")
    private const val DASH_TYPE = "application/dash+xml"

    fun of(source: DataSource, url: String): String? = try {
        source.open(DataSpec.Builder().setUri(url).setLength(PEEK_BYTES.toLong()).build())
        val type = source.responseHeaders.entries
            .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }
            ?.value?.firstOrNull()?.substringBefore(';')?.trim()?.lowercase()
        when (type) {
            in HLS_TYPES -> MimeTypes.APPLICATION_M3U8
            DASH_TYPE -> MimeTypes.APPLICATION_MPD
            else -> fromStart(peek(source))
        }
    } catch (_: IOException) {
        null
    } finally {
        runCatching { source.close() }
    }

    private fun fromStart(text: String): String? {
        val start = text.trimStart(Char(0xFEFF), ' ', '\t', '\r', '\n')
        return when {
            start.startsWith("#EXTM3U") -> MimeTypes.APPLICATION_M3U8
            start.contains("<MPD") -> MimeTypes.APPLICATION_MPD
            else -> null
        }
    }

    private fun peek(source: DataSource): String {
        val buffer = ByteArray(PEEK_BYTES)
        var read = 0
        while (read < buffer.size) {
            val n = source.read(buffer, read, buffer.size - read)
            if (n < 0) break
            read += n
        }
        return String(buffer, 0, read, Charsets.UTF_8)
    }
}
