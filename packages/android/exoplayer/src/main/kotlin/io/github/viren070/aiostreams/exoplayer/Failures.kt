package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.ParserException
import androidx.media3.common.PlaybackException
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException

@OptIn(UnstableApi::class)
internal object Failures {
    private const val REASON_CHARS = 200

    /** Errors loading the link. */
    private val LINK = 2000..2999

    private val DECODING = setOf(
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
    )

    private val UNEXPECTED = setOf(PlaybackException.ERROR_CODE_UNSPECIFIED, PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK)

    fun isLink(error: PlaybackException) = error.errorCode in LINK

    /** mpv's words for a link that failed to load, which the page knows, and why it failed. */
    fun linkFailure(error: PlaybackException): Pair<String, String> {
        val causes = generateSequence<Throwable>(error) { it.cause }.toList()
        causes.filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.let {
            return "loading failed" to "HTTP error ${it.responseCode} ${it.responseMessage.orEmpty()}".trim()
        }
        return "loading failed" to when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "could not connect to the server"
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "the server took too long to answer"
            else -> error.errorCodeName.removePrefix("ERROR_CODE_IO_").lowercase().replace('_', ' ')
        }
    }

    /** Why ExoPlayer can't play the file, with Media3's own reason. */
    fun unplayable(error: PlaybackException): String {
        undecodable(error)?.let { return it }
        val causes = generateSequence<Throwable>(error) { it.cause }.toList()
        if (causes.any { it is UnrecognizedInputFormatException }) return "ExoPlayer doesn't recognise this file's format"
        val code = error.errorCodeName.removePrefix("ERROR_CODE_").lowercase().replace('_', ' ')
        val reason = causes.filterIsInstance<ParserException>().firstNotNullOfOrNull { reasonOf(it) }
            ?: listOfNotNull(code, unexpected(error, causes)).joinToString(": ")
        return "ExoPlayer can't play this file: $reason"
    }

    /** The file's video, or all of its audio, which the device has no decoder for at all. */
    fun undecodable(tracks: Tracks): String? {
        for ((type, kind) in listOf(C.TRACK_TYPE_VIDEO to "video", C.TRACK_TYPE_AUDIO to "audio")) {
            val groups = tracks.groups.filter { it.type == type }
            val decodable = groups.any { group -> (0 until group.length).any { group.isTrackSupported(it, true) } }
            if (groups.isNotEmpty() && !decodable) return cantPlay(groups[0].getTrackFormat(0), kind)
        }
        return null
    }

    private fun undecodable(error: PlaybackException): String? {
        if (error.errorCode !in DECODING) return null
        val format = (error as? ExoPlaybackException)?.rendererFormat
        return cantPlay(format, if (MimeTypes.isAudio(format?.sampleMimeType)) "audio" else "video")
    }

    private fun cantPlay(format: Format?, kind: String): String {
        val codec = when (format?.sampleMimeType) {
            // Not codecOf's hevc: the device may well play HEVC, just not this profile.
            MimeTypes.VIDEO_DOLBY_VISION ->
                "Dolby Vision" + format.codecs?.split('.')?.getOrNull(1)?.toIntOrNull()?.let { " profile $it" }.orEmpty()
            else -> format?.let(ExoTracks::codecOf)?.takeIf { it.isNotEmpty() }
        }
        return "this device can't play ${listOfNotNull(codec, kind).joinToString(" ")}"
    }

    /** The words of an exception Media3 didn't expect, which its code says nothing of. */
    private fun unexpected(error: PlaybackException, causes: List<Throwable>): String? {
        if (error.errorCode !in UNEXPECTED) return null
        return causes.drop(1)
            .firstNotNullOfOrNull { cause -> cause.message?.lineSequence()?.first()?.trim()?.takeIf { it.isNotEmpty() } }
            ?.take(REASON_CHARS)
    }

    /** The parser's message, in plain words where it's a known one. */
    private fun reasonOf(error: ParserException): String? {
        // Media3 adds its fields to the message.
        val message = error.message.substringBefore("{contentIsMalformed").trim().takeIf { it.isNotEmpty() }
        val algorithm = message?.let { Regex("""^ContentCompAlgo (\d+) not supported""").find(it) }?.groupValues?.get(1)
        return when (algorithm) {
            null -> message
            "1" -> "it has bzip2-compressed tracks"
            "2" -> "it has LZO-compressed tracks"
            else -> "it has tracks compressed in a way it can't read"
        }
    }
}
