package io.github.viren070.aiostreams

import android.content.ComponentName
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.SurfaceView
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import io.github.viren070.aiostreams.bridge.AppBridge
import io.github.viren070.aiostreams.bridge.AppIdentity
import io.github.viren070.aiostreams.bridge.WebApp
import io.github.viren070.aiostreams.engine.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.PlayerChannel
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The video beneath, the page over it, and the bridge between them. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: AppBridge
    private lateinit var engine: MpvEngine
    private lateinit var player: PlayerChannel
    private lateinit var pip: PictureInPicture
    private lateinit var focus: AudioFocus
    private lateinit var controller: ListenableFuture<MediaController>
    private val screen = PlayerWindow(this)
    private val levels by lazy { Levels(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val video = SurfaceView(this)
        // Edge to edge: the page keeps clear of the system bars with its own safe-area insets.
        web = WebView(this)
        setContentView(FrameLayout(this).apply {
            addView(video, MATCH_PARENT, MATCH_PARENT)
            addView(web, MATCH_PARENT, MATCH_PARENT)
        })

        val app = WebApp(BuildConfig.WEB_URL.ifEmpty { null })
        app.configure(web)
        engine = MpvEngine(this)
        player = PlayerChannel(engine, send = { bridge.send(it) })
        bridge = AppBridge(web, app.origins, AppIdentity(BuildConfig.VERSION_NAME, deviceName()), ::onMessage)
        pip = PictureInPicture(this, video)
        focus = AudioFocus(
            this,
            pause = { engine.setProperty("pause", "yes") },
            resume = { engine.setProperty("pause", "no") },
        )
        video.holder.addCallback(engine.surface)
        player.start()
        player.session.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) = onPlayerChanged()
        })
        PlaybackService.player = player.session
        // Connecting starts the service, which takes over the notification once playback starts.
        controller = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java)))
            .buildAsync()
        web.loadUrl(app.startUrl)

        onBackPressedDispatcher.addCallback(this) {
            when {
                screen.fullscreen -> setFullscreen(false)
                web.canGoBack() -> web.goBack()
                else -> finish()
            }
        }
    }

    private fun onMessage(type: String, message: JsonObject) {
        if (player.handle(type, message)) return
        when (type) {
            "app-info" -> bridge.send(buildJsonObject {
                put("type", "app-info")
                put("app", BuildConfig.VERSION_NAME)
                put("platform", "android")
                put("mpv", engine.property("mpv-version"))
                put("ffmpeg", engine.property("ffmpeg-version"))
            })
            "fullscreen" -> setFullscreen(message["value"]?.jsonPrimitive?.booleanOrNull ?: !screen.fullscreen)
            "levels" -> bridge.send(buildJsonObject {
                put("type", "levels")
                put("volume", levels.volume)
                put("brightness", levels.brightness)
            })
            "set-level" -> {
                val value = message["value"]?.jsonPrimitive?.floatOrNull
                when (message["level"]?.jsonPrimitive?.content) {
                    "volume" -> value?.let(levels::setVolume)
                    "brightness" -> levels.setBrightness(value)
                }
            }
            "web-error" -> Log.e("page", message["message"]?.jsonPrimitive?.content.orEmpty())
        }
    }

    private fun onPlayerChanged() {
        val session = player.session
        val playing = session.playWhenReady && session.playbackState != Player.STATE_IDLE
        screen.keepAwake(playing)
        focus.update(playing)
        pip.update(playing && session.item?.pip == true, session.videoSize)
    }

    private fun setFullscreen(on: Boolean) {
        screen.setFullscreen(on)
        bridge.send(buildJsonObject {
            put("type", "fullscreen")
            put("value", on)
        })
    }

    private fun deviceName(): String =
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        pip.onUserLeaveHint()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        bridge.send(buildJsonObject {
            put("type", "pip")
            put("value", isInPictureInPictureMode)
        })
        // Closing the window, rather than opening it full size, stops playback.
        if (!isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED) {
            engine.setProperty("pause", "yes")
        }
    }

    override fun onStop() {
        super.onStop()
        val background = player.session.item?.background == true
        if (!isChangingConfigurations && !isInPictureInPictureMode && !background) engine.setProperty("pause", "yes")
    }

    override fun onDestroy() {
        MediaController.releaseFuture(controller)
        PlaybackService.player = null
        focus.release()
        engine.release()
        web.destroy()
        super.onDestroy()
    }
}
