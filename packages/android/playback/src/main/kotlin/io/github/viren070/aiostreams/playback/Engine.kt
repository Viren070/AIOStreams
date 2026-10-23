package io.github.viren070.aiostreams.playback

import android.content.Context
import android.view.View
import kotlinx.serialization.json.JsonObject

/** A player the page drives through [PlayerProtocol]'s requests. Callbacks may come on any thread. */
interface Engine {
    /** Its name and version, for diagnostics. */
    val description: String

    fun start(listener: Listener)

    fun load(request: LoadRequest)

    fun stop()

    fun change(change: Change)

    /** A keyframe up to [snapMs] away may stand in for [positionMs]. */
    fun seek(positionMs: Double, snapMs: Double = 0.0)

    /** Adds a subtitle file, from the server or this device, and shows it in place of track [replace]. */
    fun addSubtitle(url: String, title: String?, language: String?, replace: Int? = null)

    fun setStyle(style: Style)

    /** Stretches the page skips or offers to, which an engine fetching ahead can leave out or fetch past early. */
    fun setSkips(skips: List<Skip>) {}

    /** [PlayerSettings.passthrough] is already the formats the output takes. */
    fun setSettings(settings: PlayerSettings)

    /** Reports the lines of one of the file's own subtitles as it reads them, or stops with null. */
    fun watchSubtitleLines(track: String?) {}

    /** mpv's own stats overlay, on one of its pages or off. */
    fun showStatsOverlay(page: String?) {}

    /** One of mpv's properties, or the engine's own answer to it, for diagnostics. */
    fun property(name: String): String?

    /** The view the video is drawn in, which goes beneath the page. */
    fun createView(context: Context): View

    /** Frames shown and dropped so far, and what else measures the playback. */
    fun stats(): JsonObject

    /** False plays the HDR10 picture a Dolby Vision video carries instead, from the next file. */
    fun setDolbyVision(on: Boolean)

    fun setSound(sound: Sound)

    fun release()

    interface Listener {
        fun onState(state: PlayerState)

        fun onTracks(tracks: List<PlayerTrack>)

        fun onChapters(chapters: List<PlayerChapter>)

        /** `start`, `loaded` or `restart`. */
        fun onEvent(name: String)

        /** `cause` is the network error behind a failed load, where there was one. */
        fun onEnded(reason: String, error: String?, cause: String?)

        /** The engine can't play the file, which another engine might. */
        fun onUnplayable(error: String)

        fun onSubtitleLines(track: String, lines: List<SubtitleLine>)

        /** The picture's display size and the stream's frame rate, each once known. */
        fun onVideo(width: Int? = null, height: Int? = null, frameRate: Double? = null)
    }
}
