package io.github.viren070.aiostreams

import android.content.Context
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import io.github.viren070.aiostreams.exoplayer.ExoEngine
import io.github.viren070.aiostreams.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.PlayerChannel

/**
 * The engine drawing beneath the page: the one the page picked, or with
 * `auto`, ExoPlayer for each file and mpv for a file ExoPlayer can't play.
 */
class Playback(private val context: Context, private val announce: (engine: String) -> Unit) {
    private val saved = context.getSharedPreferences("playback", Context.MODE_PRIVATE)
    private var choice = saved.getString("engine", null)?.takeIf { it in CHOICES } ?: AUTO
    private var name = engineFor(choice)

    /** Where the engine's view goes. */
    val stage = FrameLayout(context)

    var tunneling = false
        set(value) {
            field = value
            (engine as? ExoEngine)?.setTunneling(value)
        }

    var engine: Engine = create(name)
        private set

    init {
        stage.addView(engine.createView(context), MATCH_PARENT, MATCH_PARENT)
    }

    /** Hidden while nothing plays: a surface keeps showing its last frame, and an HDR one keeps the display in HDR. */
    fun showVideo(shown: Boolean) {
        stage.visibility = if (shown) View.VISIBLE else View.INVISIBLE
    }

    /** The page's pick, which the next start keeps too. */
    fun choose(choice: String, player: PlayerChannel) {
        if (choice !in CHOICES) return
        this.choice = choice
        saved.edit().putString("engine", choice).apply()
        use(engineFor(choice), player, reload = false)
        announce(name)
    }

    /** Each file starts on the picked engine again, whatever the last one needed. */
    fun beforeLoad(player: PlayerChannel) = use(engineFor(choice), player, reload = false)

    /** mpv takes the file over where ExoPlayer stopped; false when the pick doesn't allow it. */
    fun fallBack(player: PlayerChannel): Boolean {
        if (choice != AUTO || name == MPV) return false
        use(MPV, player, reload = true)
        return true
    }

    /** The page's retry of a file that failed, on the other engine; the next file starts on the pick again. */
    fun retry(next: String, player: PlayerChannel) {
        if (next == MPV || next == EXOPLAYER) use(next, player, reload = true)
    }

    private fun use(next: String, player: PlayerChannel, reload: Boolean) {
        if (next == name) return
        name = next
        // The old engine lets go of its surface while it still runs.
        stage.removeAllViews()
        val engine = create(next)
        stage.addView(engine.createView(context), MATCH_PARENT, MATCH_PARENT)
        player.replace(engine, reload)
        this.engine = engine
        announce(next)
    }

    private fun create(name: String): Engine = when (name) {
        EXOPLAYER -> ExoEngine(context).also { it.setTunneling(tunneling) }
        else -> MpvEngine(context)
    }

    private companion object {
        const val AUTO = "auto"
        const val MPV = "mpv"
        const val EXOPLAYER = "exoplayer"
        val CHOICES = setOf(AUTO, MPV, EXOPLAYER)

        fun engineFor(choice: String) = if (choice == MPV) MPV else EXOPLAYER
    }
}
