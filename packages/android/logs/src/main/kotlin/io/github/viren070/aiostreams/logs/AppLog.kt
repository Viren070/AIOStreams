package io.github.viren070.aiostreams.logs

import android.util.Log
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * The app's log: the system's, and a file of the app's own lines that problem
 * reports read, as the system's buffer is shared and some devices keep few of them.
 * Links written to either lose their logins.
 */
object AppLog {
    @Volatile
    private var file: LogFile? = null
    private val written = ConcurrentHashMap.newKeySet<String>()

    /** The tags of the lines written here, which the system's log needn't show again. */
    val tags: Set<String> get() = written

    /** Once, as the app starts; lines before it reach the system's log alone. */
    fun open(dir: File) {
        file = LogFile(dir)
    }

    fun i(tag: String, message: String) = write(Log.INFO, tag, message)

    /** An expected failure, on one line. */
    fun w(tag: String, message: String, error: Throwable? = null) =
        write(Log.WARN, tag, error?.let { "$message: ${it.brief()}" } ?: message)

    /** An unexpected failure, with where it happened. */
    fun e(tag: String, message: String, error: Throwable? = null) =
        write(Log.ERROR, tag, error?.let { "$message\n${it.stackTraceToString().trimEnd()}" } ?: message)

    fun write(priority: Int, tag: String, message: String) {
        val masked = maskLinks(message)
        Log.println(priority, tag, masked)
        written += tag
        file?.append(priority, tag, masked)
    }

    fun lines(count: Int, pid: Int? = null, until: Long = Long.MAX_VALUE): List<String> =
        file?.lines(count, pid, until).orEmpty()
}

/** A failure's type and message, then its causes' that the line doesn't already quote, on one line. */
fun Throwable.brief(): String = generateSequence(this) { it.cause }
    .take(MAX_CAUSES)
    .fold("") { line, e ->
        val message = e.message.orEmpty()
        when {
            line.isEmpty() -> "${e.javaClass.simpleName}: $message"
            message.isNotEmpty() && message in line -> line
            else -> "$line; caused by ${e.javaClass.simpleName}: $message"
        }
    }

private const val MAX_CAUSES = 4
