package io.github.viren070.aiostreams.playback

import android.content.Context
import android.view.View
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * A player the page drives in mpv's terms: its commands and properties, and
 * mpv's names for what it reports. Callbacks may come on any thread.
 */
interface Engine {
    /** Its name and version, for diagnostics. */
    val description: String

    fun start(listener: Listener)

    fun command(args: List<String>)

    fun setProperty(name: String, value: String)

    fun property(name: String): String?

    /** The view the video is drawn in, which goes beneath the page. */
    fun createView(context: Context): View

    /** Frames shown and dropped so far, and what else measures the playback. */
    fun stats(): JsonObject

    fun release()

    interface Listener {
        fun onProperty(name: String, value: JsonElement)

        fun onEvent(name: String)

        /** `cause` is the network error behind a failed load, where there was one. */
        fun onEnded(reason: String, error: String?, cause: String?)

        /** The engine can't decode the file, which another engine might. */
        fun onUnplayable(error: String)
    }
}
