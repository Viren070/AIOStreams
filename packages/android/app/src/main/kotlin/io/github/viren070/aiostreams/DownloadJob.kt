package io.github.viren070.aiostreams

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import io.github.viren070.aiostreams.downloads.Workload

/**
 * Keeps downloads going out of sight on Android 14 and later, as a user-initiated
 * data transfer job: unlike a data sync service it has no daily limit, and the
 * system starts it again, with the queue, after it stopped it or the app.
 */
@RequiresApi(34)
class DownloadJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        running = this to params
        fetchedAtStart = latest.fetched
        notify(this, latest, force = true)
        Downloads.queue(this)
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        running = null
        return !latest.idle
    }

    companion object {
        private const val ID = 1
        private const val UPDATE_MS = 1_000L

        @Volatile
        private var latest = Workload(emptyList(), 0, wifiOnly = true, fetched = 0)

        @Volatile
        private var fetchedAtStart = 0L

        @Volatile
        private var running: Pair<DownloadJob, JobParameters>? = null
        private var notifiedAt = 0L

        /** False when Android refuses the job, as from the background. Called on the queue's thread. */
        fun update(context: Context, work: Workload): Boolean {
            latest = work
            val scheduler = context.getSystemService(JobScheduler::class.java)
            val (job, params) = running ?: (null to null)
            if (work.idle) {
                running = null
                if (job != null && params != null) job.jobFinished(params, false) else scheduler.cancel(ID)
                return true
            }
            if (job != null) {
                notify(job, work, force = false)
                return true
            }
            val pending = scheduler.getPendingJob(ID)
            if (pending != null && pending.wifiOnly() == work.wifiOnly) return true
            return try {
                scheduler.schedule(info(context, work.wifiOnly)) == JobScheduler.RESULT_SUCCESS
            } catch (e: RuntimeException) {
                Log.w("downloads", "could not schedule the download job", e)
                false
            }
        }

        private fun notify(job: DownloadJob, work: Workload, force: Boolean) {
            val params = running?.second ?: return
            val now = SystemClock.uptimeMillis()
            if (!force && now - notifiedAt < UPDATE_MS) return
            notifiedAt = now
            job.setNotification(
                params,
                DownloadService.NOTIFICATION,
                DownloadService.notification(job, work.running),
                JobService.JOB_END_NOTIFICATION_POLICY_REMOVE,
            )
            // So the system sees the transfer is moving rather than stalled.
            job.updateTransferredNetworkBytes(params, work.fetched - fetchedAtStart, 0)
        }

        private fun info(context: Context, wifiOnly: Boolean): JobInfo {
            val network = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            if (wifiOnly) network.addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            return JobInfo.Builder(ID, ComponentName(context, DownloadJob::class.java))
                .setUserInitiated(true)
                .setRequiredNetwork(network.build())
                .setPersisted(true)
                .build()
        }

        private fun JobInfo.wifiOnly() =
            requiredNetwork?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    }
}
