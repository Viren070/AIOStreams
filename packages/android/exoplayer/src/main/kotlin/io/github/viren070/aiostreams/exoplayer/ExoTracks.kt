package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import io.github.viren070.aiostreams.playback.LoadRequest
import io.github.viren070.aiostreams.playback.PlayerTrack
import io.github.viren070.aiostreams.playback.SubtitleMode

/** The load's track choices, which pick the tracks as mpv would. */
internal class TrackOptions(request: LoadRequest?) {
    private val mode = request?.subtitleMode ?: SubtitleMode.DEFAULT
    val alang = request?.audioLanguages.orEmpty().map(::languageOf)
    val slang = if (mode == SubtitleMode.FORCED || mode == SubtitleMode.NONE) {
        emptyList()
    } else {
        request?.subtitleLanguages.orEmpty().map(::languageOf)
    }
    val none = mode == SubtitleMode.NONE
    val subsFallback = when (mode) {
        SubtitleMode.ALWAYS -> "yes"
        SubtitleMode.FORCED -> "no"
        else -> "default"
    }
    val subsFallbackForced = if (mode == SubtitleMode.FORCED) "always" else "yes"
    val subsWithMatchingAudio = mode != SubtitleMode.SMART
}

/** The file's tracks, numbered from 1 within each type as mpv numbers them. */
@OptIn(UnstableApi::class)
internal class ExoTracks {
    private class Entry(val type: String, val id: Int, val group: Tracks.Group, val index: Int) {
        val format: Format get() = group.getTrackFormat(index)
        val lang: String? get() = format.language?.let(::languageOf)
        val default get() = format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0
        val forced get() = format.selectionFlags and C.SELECTION_FLAG_FORCED != 0
        val selected get() = group.isTrackSelected(index)
    }

    private var entries = emptyList<Entry>()

    fun update(tracks: Tracks) {
        val counts = mutableMapOf<String, Int>()
        entries = tracks.groups.flatMap { group ->
            val type = typeOf(group.type) ?: return@flatMap emptyList()
            (0 until group.length).filter { group.isTrackSupported(it, true) }.map { index ->
                Entry(type, (counts[type] ?: 0).inc().also { counts[type] = it }, group, index)
            }
        }
    }

    fun isEmpty() = entries.isEmpty()

    fun count(type: String) = entries.count { it.type == type }

    /** The selected track's id of `type`, or null when none plays. */
    fun selected(type: String): Int? = entries.firstOrNull { it.type == type && it.selected }?.id

    fun format(type: String): Format? = entries.firstOrNull { it.type == type && it.selected }?.format

    fun list(): List<PlayerTrack> = entries.filter { it.type != "video" }.map { entry ->
        val format = entry.format
        PlayerTrack(
            id = entry.id.toString(),
            type = if (entry.type == "sub") "subtitle" else entry.type,
            title = format.label,
            language = format.language?.takeIf { it != C.LANGUAGE_UNDETERMINED },
            codec = codecOf(format),
            default = entry.default,
            forced = entry.forced,
            hearingImpaired = format.roleFlags and C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND != 0,
            visualImpaired = format.roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO != 0,
        )
    }

    /** Plays track `id` of `type`, or none of that type for `null`. */
    fun select(parameters: TrackSelectionParameters.Builder, type: String, id: Int?) {
        val trackType = trackTypeOf(type)
        val entry = id?.let { wanted -> entries.find { it.type == type && it.id == wanted } }
        parameters.setTrackTypeDisabled(trackType, entry == null)
        parameters.clearOverridesOfType(trackType)
        if (entry != null) parameters.addOverride(TrackSelectionOverride(entry.group.mediaTrackGroup, entry.index))
    }

    /** The audio track mpv picks: the first language asked for, then the file's default. */
    fun chooseAudio(options: TrackOptions): Int? {
        val audio = entries.filter { it.type == "audio" }
        return options.alang.firstNotNullOfOrNull { lang -> audio.find { it.lang == lang } }?.id
            ?: audio.find { it.default }?.id
            ?: audio.firstOrNull()?.id
    }

    /** The subtitle track mpv picks, from the languages asked for and its fallbacks. */
    fun chooseSubtitle(options: TrackOptions, audioLang: String?): Int? {
        if (options.none) return null
        val subs = entries.filter { it.type == "sub" }
        val forcedForAudio = subs.find { it.forced && it.lang == audioLang }
        if (options.subsFallbackForced == "always" && forcedForAudio != null) return forcedForAudio.id
        val matched = options.slang.firstNotNullOfOrNull { lang ->
            val inLang = subs.filter { it.lang == lang }
            inLang.firstOrNull { !it.forced && it.default } ?: inLang.firstOrNull { !it.forced } ?: inLang.firstOrNull()
        }
        val picked = matched ?: when (options.subsFallback) {
            "yes" -> subs.find { it.default } ?: subs.firstOrNull()
            "default" -> subs.find { it.default }
            else -> null
        }
        val wanted = picked?.takeUnless { !it.forced && !options.subsWithMatchingAudio && it.lang == audioLang }
        return (wanted ?: forcedForAudio.takeIf { options.subsFallbackForced != "no" })?.id
    }

    fun languageOfTrack(type: String, id: Int?): String? = entries.find { it.type == type && it.id == id }?.lang

    companion object {
        fun trackTypeOf(type: String) = when (type) {
            "video" -> C.TRACK_TYPE_VIDEO
            "audio" -> C.TRACK_TYPE_AUDIO
            else -> C.TRACK_TYPE_TEXT
        }

        private fun typeOf(trackType: Int) = when (trackType) {
            C.TRACK_TYPE_VIDEO -> "video"
            C.TRACK_TYPE_AUDIO -> "audio"
            C.TRACK_TYPE_TEXT -> "sub"
            else -> null
        }

        /** FFmpeg's names, which mpv reports and the page knows. */
        fun codecOf(format: Format): String = when (val mime = originalMimeType(format)) {
            MimeTypes.VIDEO_H264 -> "h264"
            MimeTypes.VIDEO_H265, MimeTypes.VIDEO_DOLBY_VISION -> "hevc"
            MimeTypes.VIDEO_AV1 -> "av1"
            MimeTypes.VIDEO_VP9 -> "vp9"
            MimeTypes.AUDIO_AAC -> "aac"
            MimeTypes.AUDIO_AC3 -> "ac3"
            MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "eac3"
            MimeTypes.AUDIO_TRUEHD -> "truehd"
            MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS -> "dts"
            MimeTypes.AUDIO_OPUS -> "opus"
            MimeTypes.AUDIO_FLAC -> "flac"
            MimeTypes.AUDIO_MPEG -> "mp3"
            MimeTypes.AUDIO_VORBIS -> "vorbis"
            MimeTypes.TEXT_SSA -> "ass"
            MimeTypes.APPLICATION_SUBRIP -> "subrip"
            MimeTypes.TEXT_VTT -> "webvtt"
            MimeTypes.APPLICATION_PGS -> "hdmv_pgs_subtitle"
            MimeTypes.APPLICATION_VOBSUB -> "dvd_subtitle"
            MimeTypes.APPLICATION_DVBSUBS -> "dvb_subtitle"
            else -> mime?.substringAfter('/').orEmpty()
        }

        /** Media3 parses subtitles as it reads them, and keeps their own type in `codecs`. */
        private fun originalMimeType(format: Format) =
            if (format.sampleMimeType == MimeTypes.APPLICATION_MEDIA3_CUES) format.codecs else format.sampleMimeType ?: format.codecs
    }
}

/** Two- and three-letter codes alike, as mpv matches them. */
@OptIn(UnstableApi::class)
internal fun languageOf(code: String): String = Util.normalizeLanguageCode(code.trim().lowercase()) ?: code
