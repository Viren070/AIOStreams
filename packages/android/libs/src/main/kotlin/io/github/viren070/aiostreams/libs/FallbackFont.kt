package io.github.viren070.aiostreams.libs

import android.content.Context
import java.io.File

/** The font subtitles are drawn in where a script's own fonts are missing. */
object FallbackFont {
    // In mpv's config folder, which is where mpv looks for it.
    fun file(context: Context): File = File(File(context.filesDir, "mpv").apply { mkdirs() }, "subfont.ttf").also {
        if (!it.exists()) context.resources.openRawResource(R.raw.subfont).use { input -> it.outputStream().use(input::copyTo) }
    }
}
