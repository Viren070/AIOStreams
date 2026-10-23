package io.github.viren070.aiostreams

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import io.github.viren070.aiostreams.downloads.DownloadQueue
import java.io.File

/** The process's one download queue, which outlives the activity. */
object Downloads {
    @Volatile
    private var queue: DownloadQueue? = null

    @Volatile
    private var unmetered = false

    fun queue(context: Context): DownloadQueue =
        queue ?: synchronized(this) { queue ?: create(context.applicationContext).also { queue = it } }

    /** The app's own folder on each storage that is in, the device's own first. */
    fun folders(context: Context): List<File> =
        context.getExternalFilesDirs(Environment.DIRECTORY_MOVIES).filterNotNull()
            .filter { Environment.getExternalStorageState(it) == Environment.MEDIA_MOUNTED }

    /** Where new downloads go: the one picked while its storage is in. */
    fun folder(context: Context): File {
        val picked = prefs(context).getString(FOLDER, null)
        val folders = folders(context)
        return folders.find { it.path == picked } ?: folders.firstOrNull() ?: File(context.filesDir, "downloads")
    }

    fun setFolder(context: Context, folder: File) {
        prefs(context).edit().putString(FOLDER, folder.path).apply()
        queue(context).setFolder(folder)
    }

    private fun prefs(context: Context) = context.getSharedPreferences("downloads", Context.MODE_PRIVATE)

    private const val FOLDER = "folder"

    private fun create(context: Context): DownloadQueue {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        unmetered = !connectivity.isActiveNetworkMetered
        val queue = DownloadQueue(
            stateFile = File(context.filesDir, "downloads.json"),
            // The app's own folders need no permission and go with the app.
            folder = folder(context),
            userAgent = "AIOStreams Android/${BuildConfig.VERSION_NAME}",
            unmetered = { unmetered },
        )
        queue.onWorkload = { work ->
            // A service where Android refuses the job, as from the background.
            val job = Build.VERSION.SDK_INT >= 34 && DownloadJob.update(context, work)
            DownloadService.update(context, if (job) emptyList() else work.running)
        }
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                setUnmetered(
                    queue,
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ||
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED),
                )
            }

            override fun onLost(network: Network) = setUnmetered(queue, false)
        })
        return queue
    }

    private fun setUnmetered(queue: DownloadQueue, value: Boolean) {
        if (value == unmetered) return
        unmetered = value
        queue.networkChanged()
    }
}
