package io.github.viren070.aiostreams

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.viren070.aiostreams.downloads.Running

/** Keeps downloads going out of sight, with their progress in a notification. */
class DownloadService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ServiceCompat.startForeground(
            this, NOTIFICATION, notification(this, latest), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        return START_NOT_STICKY
    }

    // Android 15 allows data transfers six hours a day out of sight.
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    companion object {
        private const val NOTIFICATION = 2
        private const val CHANNEL = "downloads"
        private const val UPDATE_MS = 1_000L

        @Volatile
        private var latest = emptyList<Running>()
        private var started = false
        private var notifiedAt = 0L

        /** Called on the queue's thread. */
        @SuppressLint("MissingPermission")
        fun update(context: Context, running: List<Running>) {
            latest = running
            val intent = Intent(context, DownloadService::class.java)
            if (running.isEmpty()) {
                if (started) context.stopService(intent)
                started = false
                return
            }
            if (!started) {
                try {
                    ContextCompat.startForegroundService(context, intent)
                    started = true
                } catch (e: IllegalStateException) {
                    // Android refuses it from the background; the downloads still run.
                    Log.w("downloads", "could not start the download service", e)
                }
                return
            }
            val now = SystemClock.uptimeMillis()
            if (now - notifiedAt < UPDATE_MS) return
            notifiedAt = now
            val notifications = NotificationManagerCompat.from(context)
            if (notifications.areNotificationsEnabled()) notifications.notify(NOTIFICATION, notification(context, running))
        }

        private fun notification(context: Context, running: List<Running>): Notification {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW),
            )
            val total = running.sumOf { it.total ?: 0 }
            val known = running.all { it.total != null } && total > 0
            val share = if (known) (running.sumOf { it.bytes } * 100 / total).toInt() else 0
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            return NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(running.singleOrNull()?.title ?: "Downloading ${running.size} items")
                .setContentText(if (known) "$share%" else null)
                .setProgress(100, share, !known)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .build()
        }
    }
}
