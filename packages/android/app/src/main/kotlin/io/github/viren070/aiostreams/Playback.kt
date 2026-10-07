package io.github.viren070.aiostreams

import android.content.Context
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import io.github.viren070.aiostreams.exoplayer.ExoEngine
import io.github.viren070.aiostreams.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.Engine
import io.github.viren070.aiostreams.playback.PlayerChannel

/** The engine the page picked, mpv or ExoPlayer, drawing beneath it. */
class Playback(private val context: Context) {
    private val saved = context.getSharedPreferences("playback", Context.MODE_PRIVATE)
    private var name = saved.getString("engine", null)?.takeIf { it in ENGINES } ?: MPV

    /** Where the engine's view goes. */
    val stage = FrameLayout(context)

    var engine: Engine = create(name)
        private set

    init {
        stage.addView(engine.createView(context), MATCH_PARENT, MATCH_PARENT)
    }

    /** Switches to `name`'s engine, which the next start uses too. */
    fun select(name: String, player: PlayerChannel) {
        if (name == this.name || name !in ENGINES) return
        this.name = name
        saved.edit().putString("engine", name).apply()
        // The old engine lets go of its surface while it still runs.
        stage.removeAllViews()
        val next = create(name)
        stage.addView(next.createView(context), MATCH_PARENT, MATCH_PARENT)
        player.replace(next)
        engine = next
    }

    private fun create(name: String): Engine = when (name) {
        EXOPLAYER -> ExoEngine(context)
        else -> MpvEngine(context)
    }

    private companion object {
        const val MPV = "mpv"
        const val EXOPLAYER = "exoplayer"
        val ENGINES = setOf(MPV, EXOPLAYER)
    }
}
