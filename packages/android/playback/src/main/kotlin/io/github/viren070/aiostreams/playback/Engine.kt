package io.github.viren070.aiostreams.playback

import android.view.SurfaceHolder
import kotlinx.serialization.json.JsonElement

/**
 * A player the page drives in mpv's terms: its commands and properties, and
 * mpv's names for what it reports. Callbacks come on the engine's own thread.
 */
interface Engine {
    fun start(listener: Listener)

    fun command(args: List<String>)

    fun setProperty(name: String, value: String)

    fun property(name: String): String?

    /** Attach to the view the video is drawn in. */
    val surface: SurfaceHolder.Callback

    fun release()

    interface Listener {
        fun onProperty(name: String, value: JsonElement)

        fun onEvent(name: String)

        /** `cause` is the network error behind a failed load, where there was one. */
        fun onEnded(reason: String, error: String?, cause: String?)
    }
}
