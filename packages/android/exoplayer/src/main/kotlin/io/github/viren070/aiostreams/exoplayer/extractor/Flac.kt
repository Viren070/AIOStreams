package io.github.viren070.aiostreams.exoplayer.extractor

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.FlacStreamMetadata

/** The STREAMINFO block in [data], bare or behind the stream marker or its block header. */
internal fun flacStreamInfo(data: ByteArray): ByteArray? {
    val from = if (data.size >= 4 && data.copyOfRange(0, 4).contentEquals(FLAC_MARKER)) 4 else 0
    if (data.size - from == STREAM_INFO_SIZE) return data.copyOfRange(from, from + STREAM_INFO_SIZE)
    if (data.size < from + 4 + STREAM_INFO_SIZE) return null
    val type = data[from].toInt() and 0x7F
    val length = (data[from + 1].toInt() and 0xFF shl 16) or (data[from + 2].toInt() and 0xFF shl 8) or
        (data[from + 3].toInt() and 0xFF)
    if (type != 0 || length != STREAM_INFO_SIZE) return null
    return data.copyOfRange(from + 4, from + 4 + STREAM_INFO_SIZE)
}

@OptIn(UnstableApi::class)
internal fun flacMaxFrameSize(format: Format): Int? {
    if (format.sampleMimeType != MimeTypes.AUDIO_FLAC) return null
    val streamInfo = format.initializationData.firstNotNullOfOrNull(::flacStreamInfo) ?: return null
    val info = FlacStreamMetadata(streamInfo, 0)
    val channels = info.channels
    val bits = info.bitsPerSample
    // No encoder writes a frame past its samples stored uncompressed; stereo's side channel is a bit wider.
    val sampleBits = if (channels == 2) 2 * bits + 1 else channels * bits
    val uncompressed = 18 + channels * ((bits + 14) / 8) + (sampleBits * info.maxBlockSizeSamples + 7) / 8
    return info.maxFrameSize.takeIf { it in 1..uncompressed } ?: uncompressed
}

private const val STREAM_INFO_SIZE = 34
private val FLAC_MARKER = byteArrayOf('f'.code.toByte(), 'L'.code.toByte(), 'a'.code.toByte(), 'C'.code.toByte())
