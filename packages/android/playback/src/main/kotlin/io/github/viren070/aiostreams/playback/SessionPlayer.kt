package io.github.viren070.aiostreams.playback

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** What the page says plays, and what it allows once the app is out of sight. */
data class NowPlayingItem(
    val title: String,
    val subtitle: String?,
    val artwork: String?,
    val previous: Boolean,
    val next: Boolean,
    val pip: Boolean,
    val background: Boolean,
)

/** mpv as a Media3 player for the media session, whose commands go to the page as `media-key`s. */
@OptIn(UnstableApi::class)
class SessionPlayer(private val send: (JsonObject) -> Unit) : SimpleBasePlayer(Looper.getMainLooper()) {
    private val main = Handler(Looper.getMainLooper())
    private val waiting = mutableMapOf<String, MutableList<SettableFuture<Unit>>>()

    var item: NowPlayingItem? = null
        private set
    private var paused = true
    private var idle = true
    private var buffering = false
    private var positionMs = 0L
    private var durationMs = C.TIME_UNSET
    private var speed = 1f
    private var size = VideoSize.UNKNOWN
    private var seeked = false

    fun setItem(item: NowPlayingItem?) {
        if (item == this.item) return
        this.item = item
        invalidateState()
    }

    fun onProperty(name: String, value: JsonElement) {
        val primitive = value as? JsonPrimitive
        when (name) {
            "pause" -> paused = primitive?.booleanOrNull ?: true
            "idle-active" -> idle = primitive?.booleanOrNull ?: true
            "paused-for-cache" -> buffering = primitive?.booleanOrNull ?: false
            "speed" -> speed = primitive?.doubleOrNull?.toFloat() ?: 1f
            "duration" -> durationMs = primitive?.doubleOrNull?.let { (it * 1000).toLong() } ?: C.TIME_UNSET
            "video-params" -> size = sizeOf(value as? JsonObject)
            "time-pos" -> {
                positionMs = ((primitive?.doubleOrNull ?: 0.0) * 1000).toLong()
                // Otherwise the session extrapolates; a seek's position can arrive either side of its event.
                if (!seeked) return
            }
            else -> return
        }
        settle(name)
        invalidateState()
    }

    fun onEvent(name: String) {
        if (name == "playback-restart") seeked = true
        settle(name)
        invalidateState()
    }

    override fun getState(): State {
        val item = item ?: return State.Builder().setPlaybackState(STATE_IDLE).build()
        val metadata = MediaMetadata.Builder()
            .setTitle(item.title)
            .setArtist(item.subtitle)
            .setArtworkUri(item.artwork?.let(Uri::parse))
            .build()
        // Neighbours stand in for the episodes either side, so the session offers next and previous.
        val playlist = listOfNotNull(
            neighbour(PREVIOUS).takeIf { item.previous },
            MediaItemData.Builder(item)
                .setMediaItem(MediaItem.Builder().setMediaMetadata(metadata).build())
                .setDurationUs(if (durationMs == C.TIME_UNSET) C.TIME_UNSET else durationMs * 1000)
                .setIsSeekable(true)
                .build(),
            neighbour(NEXT).takeIf { item.next },
        )
        val playing = !paused && !idle && !buffering
        val state = State.Builder()
            .setAvailableCommands(commands)
            .setPlaylist(playlist)
            .setCurrentMediaItemIndex(if (item.previous) 1 else 0)
            .setPlayWhenReady(!paused, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .setPlaybackState(if (idle || buffering) STATE_BUFFERING else STATE_READY)
            .setContentPositionMs(PositionSupplier.getExtrapolating(positionMs, if (playing) speed else 0f))
            .setPlaybackParameters(PlaybackParameters(speed))
            .setVideoSize(size)
            .setSeekBackIncrementMs(SKIP_MS)
            .setSeekForwardIncrementMs(SKIP_MS)
            // Previous always means the episode before, as on the desktop.
            .setMaxSeekToPreviousPositionMs(Long.MAX_VALUE)
        if (seeked) {
            seeked = false
            state.setPositionDiscontinuity(DISCONTINUITY_REASON_SEEK, positionMs)
        }
        return state.build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> =
        press(buildJsonObject { put("action", if (playWhenReady) "play" else "pause") }, until = "pause")

    override fun handleStop(): ListenableFuture<*> = press(buildJsonObject { put("action", "stop") }, until = "idle-active")

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> =
        when (seekCommand) {
            COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ->
                press(buildJsonObject { put("action", "next") }, until = "start-file")
            COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ->
                press(buildJsonObject { put("action", "previous") }, until = "start-file")
            else -> press(buildJsonObject {
                put("action", "seek")
                put("position", positionMs)
            }, until = "playback-restart")
        }

    /** Holds the session's guess of the outcome until mpv reports `until`, or gives up. */
    private fun press(key: JsonObject, until: String): ListenableFuture<*> {
        send(buildJsonObject {
            put("type", "media-key")
            put("key", key)
        })
        val done = SettableFuture.create<Unit>()
        waiting.getOrPut(until) { mutableListOf() }.add(done)
        main.postDelayed({ done.set(Unit) }, SETTLE_MS)
        return done
    }

    private fun settle(name: String) {
        waiting.remove(name)?.forEach { it.set(Unit) }
    }

    private val commands: Player.Commands
        get() = Player.Commands.Builder()
            .addAll(
                COMMAND_PLAY_PAUSE, COMMAND_STOP, COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                COMMAND_SEEK_BACK, COMMAND_SEEK_FORWARD, COMMAND_GET_CURRENT_MEDIA_ITEM,
                COMMAND_GET_METADATA, COMMAND_GET_TIMELINE,
            )
            .addIf(COMMAND_SEEK_TO_NEXT, item?.next == true)
            .addIf(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, item?.next == true)
            .addIf(COMMAND_SEEK_TO_PREVIOUS, item?.previous == true)
            .addIf(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, item?.previous == true)
            .build()

    private companion object {
        const val PREVIOUS = "previous"
        const val NEXT = "next"
        const val SKIP_MS = 10_000L
        const val SETTLE_MS = 2_000L

        fun neighbour(uid: String) = MediaItemData.Builder(uid).setIsPlaceholder(true).build()

        fun sizeOf(params: JsonObject?): VideoSize {
            val width = params?.get("dw")?.jsonPrimitive?.intOrNull ?: return VideoSize.UNKNOWN
            val height = params["dh"]?.jsonPrimitive?.intOrNull ?: return VideoSize.UNKNOWN
            return VideoSize(width, height)
        }
    }
}
