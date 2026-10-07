package io.github.viren070.aiostreams

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/** The media session and its notification, which keep playback going out of sight. */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        val player = player ?: return stopSelf()
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
        /** Set by the activity before it connects. */
        var player: Player? = null
    }
}
