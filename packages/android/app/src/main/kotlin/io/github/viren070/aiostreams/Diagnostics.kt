package io.github.viren070.aiostreams

import android.content.Context
import android.os.Process
import io.github.viren070.aiostreams.logs.AppLog
import io.github.viren070.aiostreams.playback.Engine

/** Versions, the device and the recent log, for a bug report. */
fun diagnostics(context: Context, engine: Engine, web: String?, server: String?): String = buildString {
    Crashes.head(context).forEach(::appendLine)
    appendLine(Crashes.memoryNow(context))
    Crashes.doingOf(context, Process.myPid())?.let { appendLine("Doing: $it") }
    appendLine("web=\"${web.orEmpty()}\" server=\"${server.orEmpty()}\"")
    appendLine(
        "player=\"${engine.description}\" ffmpeg=${engine.property("ffmpeg-version").orEmpty()} " +
            "hwdec=${engine.property("hwdec-current").orEmpty()}",
    )
    appendLine("stats=${runCatching { engine.stats() }.getOrNull()}")
    appendLine(Crashes.webViewLine(context))
    appendLine()
    appendLine("App log:")
    AppLog.lines(Crashes.LOG_LINES).forEach(::appendLine)
    appendLine()
    appendLine("System log:")
    SystemLog.lines(Process.myPid()).forEach(::appendLine)
}
