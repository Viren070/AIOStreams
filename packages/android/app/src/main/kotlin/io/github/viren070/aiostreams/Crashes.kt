package io.github.viren070.aiostreams

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
import androidx.annotation.RequiresApi
import androidx.webkit.WebViewCompat
import io.github.viren070.aiostreams.exoplayer.mediaCapsLine
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
    /** The WebView ends its renderers to update, so an update this close explains an end. */
    private const val WEBVIEW_UPDATE_MS = 2 * 60_000L
    private const val WEEK_MS = 7 * 24 * 60 * 60 * 1000L
    private const val SUMMARY_FRAMES = 12
    private const val TRACE_LIMIT = 200_000

    private fun prefs(context: Context) = context.getSharedPreferences("crashes", Context.MODE_PRIVATE)

    private fun javaFile(context: Context) = File(context.filesDir, "crash/java.txt")

    /** Keeps an uncaught exception's whole stack, which Android's record of a crash leaves out. */
    fun install(context: Context) {
        val file = javaFile(context)
        val next = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
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
        val memory = ActivityManager.MemoryInfo().also(context.getSystemService(ActivityManager::class.java)::getMemoryInfo)
        prefs(context).edit()
            .putLong(RENDERER_AT, System.currentTimeMillis())
            .putBoolean(RENDERER_CRASHED, crashed)
            .putBoolean(RENDERER_SHOWN, shown)
            .putLong(RENDERER_FREE, memory.availMem)
            .putBoolean(RENDERER_LOW, memory.lowMemory)
            .putLong(RENDERER_APP_KB, Debug.getPss())
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
        val free = String.format(Locale.ROOT, "%.1f GB free", prefs.getLong(RENDERER_FREE, 0) / 1e9)
        val low = if (prefs.getBoolean(RENDERER_LOW, false)) ", which Android counts as low" else ""
        summary += "Memory then: $free$low; the app used ${prefs.getLong(RENDERER_APP_KB, 0) / 1024} MB"
        return assemble(context, at, null, 0, summary, emptyList(), emptyList(), page = true)
    }

    private fun webViewUpdate(context: Context, at: Long): String? {
        // What the process loaded, which an app outliving the update still holds.
        val loaded = WebViewCompat.getCurrentWebViewPackage(context) ?: return null
        val updated = runCatching { context.packageManager.getPackageInfo(loaded.packageName, 0) }
            .getOrDefault(loaded).lastUpdateTime
        if (abs(updated - at) > WEBVIEW_UPDATE_MS) return null
        return "WebView updated at ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(updated))}"
    }

    private class JavaCrash(val at: Long, val thread: String, val stack: String)

    private fun readJava(context: Context): JavaCrash? = runCatching {
        val (at, thread, stack) = javaFile(context).readText().split('\n', limit = 3)
        JavaCrash(at.toLong(), thread, stack)
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
        return assemble(context, exit.timestamp, uptimeS, exit.rss, summary, details, log ?: logOf(exit.pid))
    }

    /** Android's note on why it ended the app, such as "oom", when it left one. */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun described(exit: ApplicationExitInfo) = exit.description?.takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty()

    private fun report(context: Context, java: JavaCrash): CrashReport {
        val summary = mutableListOf<String>()
        val details = mutableListOf<String>()
        javaSummary(java, summary, details)
        return assemble(context, java.at, null, 0, summary, details, emptyList())
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
        rssKb: Long,
        summary: List<String>,
        details: List<String>,
        log: List<String>,
        page: Boolean = false,
    ): CrashReport {
        val build = if (BuildConfig.DEBUG) ", debug" else ""
        val webView = WebViewCompat.getCurrentWebViewPackage(context)?.versionName.orEmpty()
        val head = listOf(
            "AIOStreams Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}$build), " +
                "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} " +
                "(API ${Build.VERSION.SDK_INT}, ${Build.SUPPORTED_ABIS.firstOrNull().orEmpty()}), ${memoryLine(context)}",
            "Engine: ${context.getSharedPreferences("playback", Context.MODE_PRIVATE).getString("engine", null) ?: "auto"}; " +
                runCatching { mediaCapsLine(context) }.getOrDefault("Display: unknown"),
            listOfNotNull(
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at)),
                uptimeS?.let { if (it < 60) "after $it s" else "after ${it / 60} min" },
                rssKb.takeIf { it > 0 }?.let { "using ${it / 1024} MB" },
            ).joinToString(", "),
        )
        // What happened first, as a list of reports shows the first line.
        val shown = summary.take(1) + head + summary.drop(1)
        val whole = shown + "WebView $webView" + "" + details + "" + log
        return CrashReport(at, shown.joinToString("\n"), whole.joinToString("\n").trim(), page)
    }

    private fun memoryLine(context: Context): String {
        val memory = ActivityManager.MemoryInfo().also(context.getSystemService(ActivityManager::class.java)::getMemoryInfo)
        return String.format(Locale.ROOT, "%.1f GB RAM", memory.totalMem / 1e9)
    }

    /** The main thread's first frames from an ANR's thread dump. */
    private fun mainThread(trace: String): List<String> = trace.lineSequence()
        .dropWhile { !it.startsWith("\"main\"") }
        .drop(1)
        .filter { it.trimStart().startsWith("at ") || it.trimStart().startsWith("native:") }
        .take(SUMMARY_FRAMES)
        .map { it.trim() }
        .toList()

    /** A finished process's lines, while the system log still holds them; any app may read its own. */
    private fun logOf(pid: Int): List<String> = runCatching {
        ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", "400", "--pid", pid.toString())
            .redirectErrorStream(true)
            .start()
            .inputStream.bufferedReader().use { it.readLines() }
    }.getOrDefault(emptyList())
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
