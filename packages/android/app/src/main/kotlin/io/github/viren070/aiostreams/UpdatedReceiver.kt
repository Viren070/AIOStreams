package io.github.viren070.aiostreams

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * After an update the app installed, which Android closed it for, a
 * notification offers to open it again: Android lets no app start itself from
 * the background. The app clears it once open.
 */
class UpdatedReceiver : BroadcastReceiver() {
    @SuppressLint("MissingPermission")
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        // Not after an update from elsewhere, such as a store or a file.
        val version = saved.getString(INSTALLING, null) ?: return
        saved.edit().remove(INSTALLING).apply()
        val notifications = NotificationManagerCompat.from(context)
        if (!notifications.areNotificationsEnabled()) return
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = Intent(context, MainActivity::class.java)
        notifications.notify(
            NOTIFICATION,
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Updated to $version")
                .setContentText("Tap to open")
                .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build(),
        )
    }

    companion object {
        const val NOTIFICATION = 3
        private const val CHANNEL = "updates"
        private const val PREFERENCES = "updates"
        private const val INSTALLING = "installing"

        /** Marks the update about to install as the app's own. */
        fun expect(context: Context, version: String) {
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(INSTALLING, version).commit()
        }
    }
}
