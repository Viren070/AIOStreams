package io.github.viren070.aiostreams

import android.content.Context
import android.os.Build
import android.os.Process
import androidx.webkit.WebViewCompat
import io.github.viren070.aiostreams.playback.Engine

/** Versions, the device and the recent log, for a bug report. */
fun diagnostics(context: Context, engine: Engine, web: String?, server: String?): String = buildString {
    val build = if (BuildConfig.DEBUG) ", debug" else ""
    appendLine("AIOStreams Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}$build)")
    appendLine("web=\"${web.orEmpty()}\" server=\"${server.orEmpty()}\"")
    appendLine(
        "player=\"${engine.description}\" ffmpeg=${engine.property("ffmpeg-version").orEmpty()} " +
            "hwdec=${engine.property("hwdec-current").orEmpty()}",
    )
    appendLine("stats=${runCatching { engine.stats() }.getOrNull()}")
    appendLine(
        "device=\"${Build.MANUFACTURER} ${Build.MODEL}\" android=${Build.VERSION.RELEASE} api=${Build.VERSION.SDK_INT} " +
            "abi=${Build.SUPPORTED_ABIS.joinToString(",")} webview=${WebViewCompat.getCurrentWebViewPackage(context)?.versionName.orEmpty()}",
    )
    appendLine()
    append(recentLog())
}

/** The app's own lines from the system log, which any app may read. */
private fun recentLog(): String = runCatching {
    ProcessBuilder("logcat", "-d", "-t", "300", "--pid", Process.myPid().toString())
        .redirectErrorStream(true)
        .start()
        .inputStream.bufferedReader().use { it.readText() }
}.getOrDefault("")
