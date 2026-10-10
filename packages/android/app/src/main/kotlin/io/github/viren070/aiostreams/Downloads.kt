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

    private fun create(context: Context): DownloadQueue {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        unmetered = !connectivity.isActiveNetworkMetered
        // The app's own folder needs no permission and goes with the app.
        val folder = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: File(context.filesDir, "downloads")
        val queue = DownloadQueue(
            stateFile = File(context.filesDir, "downloads.json"),
            folder = folder,
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
