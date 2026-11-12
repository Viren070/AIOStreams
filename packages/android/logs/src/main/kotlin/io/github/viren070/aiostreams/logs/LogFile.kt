package io.github.viren070.aiostreams.logs

import android.os.Process
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Lines as `time pid level tag: message`, in two files of a few thousand
 * lines each: the newer one starts over once it fills, the older dropped.
 */
internal class LogFile(dir: File) {
    private val current = File(dir, "app.log")
    private val previous = File(dir, "app.1.log")
    private val pid = Process.myPid()
    private val format = SimpleDateFormat(TIME, Locale.ROOT)
    private var out: FileOutputStream? = null
    private var size = 0L

    init {
        dir.mkdirs()
    }

    @Synchronized
    fun append(priority: Int, tag: String, message: String) {
        try {
            val stream = out ?: FileOutputStream(current, true).also {
                out = it
                size = current.length()
            }
            val head = "${format.format(Date())} $pid ${LEVELS[priority] ?: '?'} $tag: "
            val bytes = message.lineSequence().joinToString("") { "$head$it\n" }.toByteArray()
            stream.write(bytes)
            size += bytes.size
            if (size > MAX_BYTES) rotate()
        } catch (_: IOException) {
            // A full disk leaves the line in the system's log alone.
        }
    }

    @Synchronized
    fun lines(count: Int, pid: Int?, until: Long): List<String> = listOf(previous, current)
        .flatMap { runCatching { it.readLines() }.getOrDefault(emptyList()) }
        .filter { line ->
            (pid == null || pidOf(line) == pid) && (until == Long.MAX_VALUE || (timeOf(line) ?: 0) <= until)
        }
        .takeLast(count)

    private fun rotate() {
        out?.close()
        out = null
        current.renameTo(previous)
    }

    private fun pidOf(line: String) = line.split(' ', limit = 4).getOrNull(2)?.toIntOrNull()

    private fun timeOf(line: String) = runCatching { format.parse(line.take(TIME.length))?.time }.getOrNull()

    private companion object {
        const val TIME = "yyyy-MM-dd HH:mm:ss.SSS"
        const val MAX_BYTES = 256 * 1024
        val LEVELS = mapOf(
            Log.VERBOSE to 'V',
            Log.DEBUG to 'D',
            Log.INFO to 'I',
            Log.WARN to 'W',
            Log.ERROR to 'E',
            Log.ASSERT to 'F',
        )
    }
}
