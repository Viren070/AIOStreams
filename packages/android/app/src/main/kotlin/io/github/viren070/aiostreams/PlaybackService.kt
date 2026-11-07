package io.github.viren070.aiostreams

import android.app.PendingIntent
import android.content.Intent
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.core.content.IntentCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import io.github.viren070.aiostreams.logs.AppLog

/** The media session and its notification, which keep playback going out of sight. */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        // Started for a media key with nothing playing: Media3 stops it after the foreground start Android requires.
        val player = player ?: return
        // Leaving the player ends playback, and its notification goes with it.
        setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        // Servers redirect artwork to its source, often from http to https.
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
        val artwork = DataSourceBitmapLoader.Builder(this)
            .setDataSourceFactory(DefaultDataSource.Factory(this, http))
            .build()
        session = MediaSession.Builder(this, player)
            .setSessionActivity(open)
            .setBitmapLoader(CacheBitmapLoader(artwork))
            .setCallback(object : MediaSession.Callback {
                // Fire OS presses pause itself when HDMI's audio drops out.
                override fun onMediaButtonEvent(
                    session: MediaSession,
                    controllerInfo: MediaSession.ControllerInfo,
                    intent: Intent,
                ): Boolean {
                    val key = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    val system = key?.deviceId == KeyCharacterMap.VIRTUAL_KEYBOARD
                    val ignored = system && key?.keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE && expectedDrop()
                    if (key?.action == KeyEvent.ACTION_DOWN) {
                        val from = if (system) "software" else InputDevice.getDevice(key.deviceId)?.name ?: "device ${key.deviceId}"
                        AppLog.i(TAG, "${KeyEvent.keyCodeToString(key.keyCode)} sent by $from${if (ignored) ", ignored after a display mode switch" else ""}")
                    }
                    return ignored || super.onMediaButtonEvent(session, controllerInfo, intent)
                }
            })
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        pauseAllPlayersAndStopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "session"

        /** Set by the activity before it connects. */
        var player: Player? = null

        /** Set by the activity: while true, lost audio is HDMI's own after a display mode switch. */
        var expectedDrop: () -> Boolean = { false }
    }
}
