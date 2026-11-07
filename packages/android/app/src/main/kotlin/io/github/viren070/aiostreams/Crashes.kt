package io.github.viren070.aiostreams

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import androidx.annotation.RequiresApi
import androidx.webkit.WebViewCompat
import io.github.viren070.aiostreams.exoplayer.video.mediaCapsLine
import io.github.viren070.aiostreams.logs.AppLog
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * How the app's last run ended, or the page's when only it restarted ([page]): [summary] fits on
 * a screen, [details] is the whole report.
 */
class CrashReport(val at: Long, val summary: String, val details: String, val page: Boolean = false)

/**
 * Runs that crashed, stopped responding or were closed for memory while in use, as Android records
 * them from Android 11, and Java crashes as the app records them on any version.
 */
object Crashes {
    private const val SEEN = "seen"
    private const val RENDERER_AT = "rendererAt"
    private const val RENDERER_CRASHED = "rendererCrashed"
    private const val RENDERER_SHOWN = "rendererShown"
    private const val RENDERER_FREE = "rendererFree"
    private const val RENDERER_LOW = "rendererLow"
    private const val RENDERER_APP_KB = "rendererAppKb"
    private const val RENDERER_DOING = "rendererDoing"
    private const val JAVA_DOING = "javaDoing"
    private const val DOING = "doing"
    private const val DOING_BEFORE = "doingBefore"
    /** The WebView ends its renderers to update, so an update this close explains an end. */
    private const val WEBVIEW_UPDATE_MS = 2 * 60_000L
    private const val WEEK_MS = 7 * 24 * 60 * 60 * 1000L
    private const val SUMMARY_FRAMES = 12
    private const val TRACE_LIMIT = 200_000
    const val LOG_LINES = 300

    private fun prefs(context: Context) = context.getSharedPreferences("crashes", Context.MODE_PRIVATE)

    private fun javaFile(context: Context) = File(context.filesDir, "crash/java.txt")

    /** Keeps an uncaught exception's whole stack, which Android's record of a crash leaves out. */
    fun install(context: Context) {
        val file = javaFile(context)
        val next = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                prefs(context).edit().putString(JAVA_DOING, doingOf(context, Process.myPid())).commit()
                file.parentFile?.mkdirs()
                file.writeText("${System.currentTimeMillis()}\n${thread.name}\n${error.stackTraceToString()}")
            }
            next?.uncaughtException(thread, error)
        }
    }

    fun seen(context: Context, at: Long) = prefs(context).edit().putLong(SEEN, at).apply()

    /**
     * The page's renderer ended, which the app outlives; reported if it crashed or was in sight.
     * Android files the renderer's own end under its isolated uid, out of the app's reach, so the
     * memory at the time is kept instead.
     */
    fun rendererGone(context: Context, crashed: Boolean, shown: Boolean) {
        val memory = memory(context)
        prefs(context).edit()
            .putLong(RENDERER_AT, System.currentTimeMillis())
            .putBoolean(RENDERER_CRASHED, crashed)
            .putBoolean(RENDERER_SHOWN, shown)
            .putLong(RENDERER_FREE, memory.availMem)
            .putBoolean(RENDERER_LOW, memory.lowMemory)
            .putLong(RENDERER_APP_KB, Debug.getPss())
            .putString(RENDERER_DOING, doingOf(context, Process.myPid()))
            .apply()
    }

    /** The newest end from the last week not yet shown. Reads files and the log, so off the main thread. */
    fun last(context: Context): CrashReport? {
        val since = maxOf(prefs(context).getLong(SEEN, 0), System.currentTimeMillis() - WEEK_MS)
        val java = readJava(context)?.takeIf { it.at > since }
        val page = pageReport(context, since)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val exit = exits(context)
                .firstOrNull { it.processName == context.packageName && it.timestamp > since && unexpected(it) }
            if (exit != null && (page == null || exit.timestamp > page.at)) {
                return report(context, exit, java?.takeIf { it.at in exit.timestamp - 60_000..exit.timestamp })
            }
        }
        return page ?: java?.let { report(context, it) }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun exits(context: Context): List<ApplicationExitInfo> =
        context.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(context.packageName, 0, 32)

    private fun pageReport(context: Context, since: Long): CrashReport? {
        val prefs = prefs(context)
        val at = prefs.getLong(RENDERER_AT, 0)
        val crashed = prefs.getBoolean(RENDERER_CRASHED, false)
        if (at <= since || !(crashed || prefs.getBoolean(RENDERER_SHOWN, false))) return null
        val summary = mutableListOf(if (crashed) "The page's renderer crashed" else "Android ended the page's renderer")
        webViewUpdate(context, at)?.let { summary += it }
        summary += "Memory then: ${free(prefs.getLong(RENDERER_FREE, 0), prefs.getBoolean(RENDERER_LOW, false))}; " +
            "the app used ${prefs.getLong(RENDERER_APP_KB, 0) / 1024} MB"
        val notes = listOfNotNull(prefs.getString(RENDERER_DOING, null)?.let { "Doing: $it" })
        return assemble(context, at, null, 0, summary, emptyList(), emptyList(), page = true, notes = notes)
    }

    private fun webViewUpdate(context: Context, at: Long): String? {
        // What the process loaded, which an app outliving the update still holds.
        val loaded = WebViewCompat.getCurrentWebViewPackage(context) ?: return null
        val updated = runCatching { context.packageManager.getPackageInfo(loaded.packageName, 0) }
            .getOrDefault(loaded).lastUpdateTime
        if (abs(updated - at) > WEBVIEW_UPDATE_MS) return null
        return "WebView updated at ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(updated))}"
    }

    private class JavaCrash(val at: Long, val thread: String, val stack: String, val doing: String?)

    private fun readJava(context: Context): JavaCrash? = runCatching {
        val (at, thread, stack) = javaFile(context).readText().split('\n', limit = 3)
        JavaCrash(at.toLong(), thread, stack, prefs(context).getString(JAVA_DOING, null))
    }.getOrNull()

    @RequiresApi(Build.VERSION_CODES.R)
    private fun unexpected(exit: ApplicationExitInfo) = when (exit.reason) {
        ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE, ApplicationExitInfo.REASON_ANR,
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE, ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
        -> true
        // Android ends apps in the background like this all the time; it only matters while one is in use.
        ApplicationExitInfo.REASON_LOW_MEMORY, ApplicationExitInfo.REASON_SIGNALED ->
            exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE
        else -> false
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun report(context: Context, exit: ApplicationExitInfo, java: JavaCrash?): CrashReport {
        val summary = mutableListOf<String>()
        val details = mutableListOf<String>()
        var uptimeS: Long? = null
        var log: List<String>? = null
        when (exit.reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE -> {
                val tombstone = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    runCatching { exit.traceInputStream?.use { Tombstone.read(it.readBytes()) } }.getOrNull()
                } else {
                    null
                }
                summary += "Native crash: ${tombstone?.signal ?: exit.description ?: "signal ${exit.status}"}"
                tombstone?.thread?.let { summary += "Thread: $it" }
                tombstone?.abort?.let { summary += "Abort: $it" }
                tombstone?.cause?.let { summary += "Cause: $it" }
                tombstone?.frames?.let { frames ->
                    summary += frames.take(SUMMARY_FRAMES).map { it.short }
                    details += frames.map { it.full }
                }
                uptimeS = tombstone?.uptimeS
                log = tombstone?.log?.takeIf { it.isNotEmpty() }
            }
            ApplicationExitInfo.REASON_CRASH -> {
                if (java != null) javaSummary(java, summary, details) else summary += "Crash: ${exit.description}"
            }
            ApplicationExitInfo.REASON_ANR -> {
                summary += "Stopped responding: ${exit.description.orEmpty()}"
                val trace = runCatching {
                    exit.traceInputStream?.use { it.readBytes().decodeToString().take(TRACE_LIMIT) }
                }.getOrNull()
                trace?.let { summary += mainThread(it) }
                trace?.let { details += it }
            }
            ApplicationExitInfo.REASON_LOW_MEMORY -> summary += "Closed by Android to free memory" + described(exit)
            ApplicationExitInfo.REASON_SIGNALED -> {
                summary += "Closed by Android: signal ${exit.status}" + described(exit)
                // How the WebView ends an app whose renderer it lost.
                webViewUpdate(context, exit.timestamp)?.let { summary += it }
            }
            else -> {
                val why = when (exit.reason) {
                    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive resource use"
                    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "failed to start"
                    else -> "reason ${exit.reason}"
                }
                summary += "Closed by Android: $why" + described(exit)
            }
        }
        val notes = listOfNotNull("Importance: ${importance(exit)}", doingOf(context, exit.pid, exit.timestamp)?.let { "Doing: $it" })
        return assemble(
            context, exit.timestamp, uptimeS, exit.pss.takeIf { it > 0 } ?: exit.rss, summary, details,
            logOf(exit.pid, exit.timestamp, log ?: SystemLog.lines(exit.pid)), notes = notes,
        )
    }

    /** Android's note on why it ended the app, such as "oom", when it left one. */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun described(exit: ApplicationExitInfo) = exit.description?.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()

    private fun report(context: Context, java: JavaCrash): CrashReport {
        val summary = mutableListOf<String>()
        val details = mutableListOf<String>()
        javaSummary(java, summary, details)
        val notes = listOfNotNull(java.doing?.let { "Doing: $it" })
        return assemble(context, java.at, null, 0, summary, details, logOf(null, java.at, emptyList()), notes = notes)
    }

    private fun javaSummary(java: JavaCrash, summary: MutableList<String>, details: MutableList<String>) {
        val lines = java.stack.lines()
        summary += "Crash in thread ${java.thread}"
        // The exception, its first frames, and what caused it, which is often the real story.
        summary += lines.take(SUMMARY_FRAMES)
        summary += lines.drop(SUMMARY_FRAMES).filter { it.startsWith("Caused by") }
        details += lines
    }

    private fun assemble(
        context: Context,
        at: Long,
        uptimeS: Long?,
        memoryKb: Long,
        summary: List<String>,
        details: List<String>,
        log: List<String>,
        page: Boolean = false,
        notes: List<String> = emptyList(),
    ): CrashReport {
        val head = head(context) + listOfNotNull(
            date(at),
            uptimeS?.let { if (it < 60) "after $it s" else "after ${it / 60} min" },
            memoryKb.takeIf { it > 0 }?.let { "using ${it / 1024} MB" },
        ).joinToString(", ") + notes
        // What happened first, as a list of reports shows the first line.
        val shown = summary.take(1) + head + summary.drop(1)
        val whole = shown + webViewLine(context) + "" + details + "" + log
        return CrashReport(at, shown.joinToString("\n"), whole.joinToString("\n").trim(), page)
    }

    fun head(context: Context): List<String> {
        val build = if (BuildConfig.DEBUG) ", debug" else ""
        val memory = memory(context)
        return listOf(
            "AIOStreams Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}$build), " +
                "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} " +
                "(API ${Build.VERSION.SDK_INT}, ${Build.SUPPORTED_ABIS.firstOrNull().orEmpty()}), " +
                String.format(Locale.ROOT, "%.1f GB RAM", memory.totalMem / 1e9),
            "Engine: ${context.getSharedPreferences("playback", Context.MODE_PRIVATE).getString("engine", null) ?: "auto"}; " +
                runCatching { mediaCapsLine(context) }.getOrDefault("Display: unknown"),
        )
    }

    fun webViewLine(context: Context) = "WebView ${WebViewCompat.getCurrentWebViewPackage(context)?.versionName.orEmpty()}"

    private fun memory(context: Context): ActivityManager.MemoryInfo =
        ActivityManager.MemoryInfo().also(context.getSystemService(ActivityManager::class.java)::getMemoryInfo)

    private fun free(bytes: Long, low: Boolean) =
        String.format(Locale.ROOT, "%.1f GB free", bytes / 1e9) + if (low) ", which Android counts as low" else ""

    fun memoryNow(context: Context): String {
        val memory = memory(context)
        return "Memory now: ${free(memory.availMem, memory.lowMemory)}; the app uses ${Debug.getPss() / 1024} MB"
    }

    private fun date(at: Long): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at))

    private class Note(val pid: Int, val since: Long, val what: String)

    private fun note(value: String?): Note? {
        val (pid, since, what) = value?.split('|', limit = 3)?.takeIf { it.size == 3 } ?: return null
        return Note(pid.toIntOrNull() ?: return null, since.toLongOrNull() ?: return null, what)
    }

    // Android reuses pids, even for the next run.
    private val started = System.currentTimeMillis() - SystemClock.elapsedRealtime() + Process.getStartElapsedRealtime()

    fun doing(context: Context, what: String) {
        val prefs = prefs(context)
        val noted = prefs.getString(DOING, null)
        val mine = note(noted)?.let { it.pid == Process.myPid() && it.since >= started } == true
        if (mine && noted?.substringAfterLast('|') == what) return
        val edit = prefs.edit()
        // Kept for the report of how the last run ended.
        if (noted != null && !mine) edit.putString(DOING_BEFORE, noted)
        edit.putString(DOING, "${Process.myPid()}|${System.currentTimeMillis()}|$what").apply()
    }

    fun doingOf(context: Context, pid: Int, at: Long = Long.MAX_VALUE): String? = listOf(DOING, DOING_BEFORE)
        .firstNotNullOfOrNull { key -> note(prefs(context).getString(key, null))?.takeIf { it.pid == pid && it.since <= at } }
        ?.let { "${it.what} since ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it.since))}" }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun importance(exit: ApplicationExitInfo) = when {
        exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "on screen"
        exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "a foreground service"
        exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible, not in front"
        exit.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "noticeable, such as a backup"
        else -> "in the background"
    }

    /** The main thread's first frames from an ANR's thread dump. */
    private fun mainThread(trace: String): List<String> = trace.lineSequence()
        .dropWhile { !it.startsWith("\"main\"") }
        .drop(1)
        .filter { it.trimStart().startsWith("at ") || it.trimStart().startsWith("native:") }
        .take(SUMMARY_FRAMES)
        .map { it.trim() }
        .toList()

    private fun logOf(pid: Int?, until: Long, system: List<String>): List<String> =
        listOf("App log:") + AppLog.lines(LOG_LINES, pid, until) +
            if (system.isEmpty()) emptyList() else listOf("", "System log:") + system
}

/** The parts of Android's tombstone protobuf (debuggerd/proto/tombstone.proto) a report shows. */
private class Tombstone(
    val signal: String?,
    val abort: String?,
    val cause: String?,
    val thread: String?,
    val frames: List<Frame>,
    val log: List<String>,
    val uptimeS: Long?,
) {
    class Frame(val short: String, val full: String)

    private class Field(val number: Int, val varint: Long, val bytes: ByteArray?) {
        val text get() = bytes?.decodeToString()
        val message get() = bytes?.let(::fields).orEmpty()
    }

    companion object {
        fun read(data: ByteArray): Tombstone {
            val top = fields(data)
            fun one(n: Int) = top.firstOrNull { it.number == n }
            val tid = one(6)?.varint?.toInt()
            // threads is a map: each entry holds the id as field 1 and the Thread as field 2.
            val thread = top.filter { it.number == 16 }.map { it.message }
                .firstOrNull { entry -> entry.firstOrNull { it.number == 1 }?.varint?.toInt() == tid }
                ?.firstOrNull { it.number == 2 }?.message.orEmpty()
            return Tombstone(
                signal = one(10)?.message?.let(::signal),
                abort = one(14)?.text?.takeIf { it.isNotBlank() },
                cause = one(15)?.message?.firstOrNull { it.number == 1 }?.text,
                thread = thread.firstOrNull { it.number == 2 }?.text,
                frames = thread.filter { it.number == 4 }.mapIndexed { i, f -> frame(i, f.message) },
                log = top.filter { it.number == 18 }.flatMap { buffer ->
                    buffer.message.filter { it.number == 2 }.map { logLine(it.message) }
                },
                uptimeS = one(20)?.varint,
            )
        }

        private fun signal(f: List<Field>): String {
            fun one(n: Int) = f.firstOrNull { it.number == n }
            val code = one(4)?.text?.let { " ($it)" }.orEmpty()
            // Proto3 leaves a zero address out.
            val fault = if (one(8)?.varint == 1L) ", fault address 0x${(one(9)?.varint ?: 0).toULong().toString(16)}" else ""
            return "${one(2)?.text ?: "signal ${one(1)?.varint}"}$code$fault"
        }

        private fun frame(index: Int, f: List<Field>): Frame {
            fun one(n: Int) = f.firstOrNull { it.number == n }
            val file = one(6)?.text.orEmpty()
            val function = one(4)?.text?.takeIf { it.isNotEmpty() }?.let { "($it+${one(5)?.varint ?: 0})" }.orEmpty()
            val pc = (one(1)?.varint ?: 0).toULong().toString(16).padStart(16, '0')
            val n = index.toString().padStart(2, '0')
            return Frame("#$n ${file.substringAfterLast('/')} $function".trim(), "#$n pc $pc  $file $function".trim())
        }

        private fun logLine(f: List<Field>): String {
            fun one(n: Int) = f.firstOrNull { it.number == n }
            val level = "??VDIWEF".getOrElse(one(4)?.varint?.toInt() ?: 0) { '?' }
            return "${one(1)?.text} ${one(2)?.varint} ${one(3)?.varint} $level ${one(5)?.text}: ${one(6)?.text}"
        }

        private fun fields(data: ByteArray): List<Field> {
            val out = ArrayList<Field>()
            var i = 0
            fun varint(): Long {
                var value = 0L
                var shift = 0
                while (true) {
                    val b = data[i++].toInt()
                    value = value or ((b and 0x7F).toLong() shl shift)
                    if (b and 0x80 == 0) return value
                    shift += 7
                }
            }
            while (i < data.size) {
                val key = varint()
                val number = (key ushr 3).toInt()
                when ((key and 7).toInt()) {
                    0 -> out += Field(number, varint(), null)
                    1 -> i += 8
                    2 -> {
                        val length = varint().toInt()
                        out += Field(number, 0, data.copyOfRange(i, i + length))
                        i += length
                    }
                    5 -> i += 4
                    else -> break
                }
            }
            return out
        }
    }
}
