package io.github.viren070.aiostreams

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Updates from the release feeds, as the desktop app's: each channel's newest
 * build sits on one release that every build replaces, with an `update.json`
 * naming the APK for each kind of processor. Installing asks the user.
 */
class Updater(private val activity: ComponentActivity, private val send: (JsonObject) -> Unit) {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "updates") }
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient()
    private val folder = File(activity.cacheDir, "updates")
    private val installed = if ("-nightly" in BuildConfig.VERSION_NAME) "nightly" else "stable"
    private var channel = installed
    private var ready: Ready? = null
    /** Waiting on the user to let this app install apps. */
    private var installing = false

    private class Ready(val file: File, val version: String)

    private val recheck = object : Runnable {
        override fun run() {
            check(null)
            main.postDelayed(this, RECHECK_MS)
        }
    }

    private val results = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION ->
                    IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                        ?.let { activity.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                // Android ends the app to replace it.
                PackageInstaller.STATUS_SUCCESS -> {}
                else -> {
                    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status"
                    Log.w(TAG, "install failed: $message")
                    worker.execute { report("error", ready?.version, "The install failed: $message") }
                }
            }
        }
    }

    init {
        ContextCompat.registerReceiver(
            activity, results, IntentFilter(INSTALLED), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        worker.execute { folder.deleteRecursively() }
        main.postDelayed(recheck, RECHECK_MS)
    }

    /** False for a message that isn't about updates. */
    fun handle(type: String, message: JsonObject): Boolean {
        when (type) {
            "update-check" -> check(message["channel"]?.jsonPrimitive?.contentOrNull)
            "update-apply" -> worker.execute { apply() }
            else -> return false
        }
        return true
    }

    fun onResume() {
        if (installing && activity.packageManager.canRequestPackageInstalls()) {
            installing = false
            worker.execute { apply() }
        }
    }

    fun release() {
        main.removeCallbacks(recheck)
        activity.unregisterReceiver(results)
        worker.shutdownNow()
    }

    /** `requested` null keeps the channel this copy came from. */
    private fun check(requested: String?) = worker.execute {
        // A build the release workflow didn't sign can't take its updates.
        if (BuildConfig.DEBUG) return@execute report("off")
        if (requested != null && requested != channel) {
            channel = requested
            ready = null
        }
        ready?.let { return@execute report("ready", it.version) }
        report("checking")
        try {
            val feed = "${BuildConfig.UPDATE_FEED}/${if (channel == "nightly") "android-nightly" else "android"}"
            val update = Json.parseToJsonElement(fetch("$feed/update.json").use { it.body.string() }).jsonObject
            val version = update["version"]!!.jsonPrimitive.content
            // Android installs nothing older, so leaving nightlies waits for the next release.
            if (update["versionCode"]!!.jsonPrimitive.long <= BuildConfig.VERSION_CODE) return@execute report("current")
            val apks = update["apks"]!!.jsonObject
            val abi = Build.SUPPORTED_ABIS.firstOrNull { it in apks }
                ?: return@execute report("error", error = "No build for this device's processor")
            val apk = apks[abi]!!.jsonObject
            val name = apk["name"]!!.jsonPrimitive.content
            report("downloading", version)
            val file = File(folder.apply { mkdirs() }, name)
            fetch("$feed/$name").use { response -> file.outputStream().use { response.body.byteStream().copyTo(it) } }
            if (sha256(file) != apk["sha256"]!!.jsonPrimitive.content) {
                file.delete()
                return@execute report("error", error = "The download was damaged")
            }
            ready = Ready(file, version)
            report("ready", version)
        } catch (e: Exception) {
            Log.w(TAG, "update check", e)
            report("error", error = e.message ?: e.javaClass.simpleName)
        }
    }

    private fun apply() {
        val update = ready ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            installing = true
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
            )
            return
        }
        try {
            val installer = activity.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(activity.packageName)
                // Once this app installed itself, Android lets it update without asking.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("update.apk", 0, update.file.length()).use { out ->
                    update.file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val done = PendingIntent.getBroadcast(
                    activity, id, Intent(INSTALLED).setPackage(activity.packageName),
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                session.commit(done.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "install", e)
            report("error", update.version, "The install failed: ${e.message}")
        }
    }

    private fun fetch(url: String) = client.newCall(Request.Builder().url(url).build()).execute().also {
        if (!it.isSuccessful) {
            it.close()
            error("The feed answered ${it.code}")
        }
    }

    private fun report(state: String, version: String? = null, error: String? = null) {
        val message = buildJsonObject {
            put("type", "update-state")
            put("state", state)
            put("channel", channel)
            put("version", version)
            put("error", error)
        }
        main.post { send(message) }
    }

    private companion object {
        const val TAG = "updates"
        const val INSTALLED = "io.github.viren070.aiostreams.UPDATE_INSTALLED"
        const val RECHECK_MS = 6 * 60 * 60 * 1000L

        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    digest.update(buffer, 0, n)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
