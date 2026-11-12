package io.github.viren070.aiostreams

import io.github.viren070.aiostreams.logs.AppLog

/**
 * A process's warnings and errors from Android and the WebView, which a report
 * shows after the app's own log. Codecs and the like fill the rest of the
 * system's log with lines below that on many devices.
 */
object SystemLog {
    fun lines(pid: Int, count: Int = LINES): List<String> = runCatching {
        ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", READ.toString(), "--pid", pid.toString())
            .redirectErrorStream(true)
            .start()
            .inputStream.bufferedReader().use { it.readLines() }
    }.getOrDefault(emptyList()).filter(::shown).takeLast(count)

    private fun shown(line: String): Boolean {
        val (level, tag) = LINE.find(line)?.destructured ?: return false
        return level in "WEF" && tag !in AppLog.tags && tag !in NOISY
    }

    private const val LINES = 80
    private const val READ = 2000
    private val LINE = Regex("^\\S+ \\S+\\s+\\d+\\s+\\d+ ([VDIWEF]) (.+?)\\s*: ")
    private val NOISY = setOf("cr_AwAutofillManager", "Codec2Client", "VideoCapabilities", "libc")
}
