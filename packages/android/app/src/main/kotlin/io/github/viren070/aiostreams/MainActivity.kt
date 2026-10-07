package io.github.viren070.aiostreams

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.SurfaceView
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import io.github.viren070.aiostreams.bridge.AppBridge
import io.github.viren070.aiostreams.bridge.AppIdentity
import io.github.viren070.aiostreams.bridge.WebApp
import io.github.viren070.aiostreams.downloads.DownloadChannel
import io.github.viren070.aiostreams.engine.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.PlayerChannel
import java.io.File
import java.util.UUID
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
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
    private lateinit var downloads: DownloadChannel
    private lateinit var updater: Updater
    private lateinit var pip: PictureInPicture
    private lateinit var focus: AudioFocus
    private lateinit var controller: ListenableFuture<MediaController>
    private val screen = PlayerWindow(this)
    private val levels by lazy { Levels(this) }
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val players = ExternalPlayers(this, ::receiveLink)
    /** `aiostreams://` links, held until the page listens. */
    private val links = ArrayDeque<String>()
    private var linksReady = false
    private var picked: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        picked?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data))
        picked = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.INSPECTABLE)

        val video = SurfaceView(this)
        // Edge to edge: the page keeps clear of the system bars with its own safe-area insets.
        web = WebView(this)
        setContentView(FrameLayout(this).apply {
            addView(video, MATCH_PARENT, MATCH_PARENT)
            addView(web, MATCH_PARENT, MATCH_PARENT)
        })

        val app = WebApp(BuildConfig.WEB_URL.ifEmpty { null })
        app.configure(web, ::chooseFiles, players::open)
        engine = MpvEngine(this)
        val queue = Downloads.queue(this)
        queue.send = { message -> runOnUiThread { bridge.send(message) } }
        downloads = DownloadChannel(queue, onAdd = ::askForNotifications)
        player = PlayerChannel(
            engine,
            send = { bridge.send(it) },
            isLocal = queue::isLocal,
            subtitles = File(cacheDir, "subtitles"),
        )
        bridge = AppBridge(web, app.origins, AppIdentity(BuildConfig.VERSION_NAME, deviceName(), deviceId()), ::onMessage)
        updater = Updater(this) { bridge.send(it) }
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
        players.restore(savedInstanceState)
        // A recreated activity has handled the link it was started with.
        if (savedInstanceState == null) receiveLink(intent)
        getSystemService(NotificationManager::class.java).cancel(UpdatedReceiver.NOTIFICATION)
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
        if (player.handle(type, message) || downloads.handle(type, message) || updater.handle(type, message)) return
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
            "links-ready" -> {
                linksReady = true
                sendLinks()
            }
            "mpv-config" -> sendMpvConfig()
            "mpv-config-save" -> {
                engine.configFile.writeText(message["text"]?.jsonPrimitive?.content.orEmpty())
                engine.reloadConfig()
                sendMpvConfig()
            }
            "diagnostics" -> {
                val web = message["web"]?.jsonPrimitive?.contentOrNull
                val server = message["server"]?.jsonPrimitive?.contentOrNull
                // Reading the log takes a moment.
                Thread {
                    val text = diagnostics(engine, web, server)
                    runOnUiThread {
                        bridge.send(buildJsonObject {
                            put("type", "diagnostics")
                            put("text", text)
                        })
                    }
                }.start()
            }
        }
    }

    private fun onPlayerChanged() {
        val session = player.session
        val playing = session.playWhenReady && session.playbackState != Player.STATE_IDLE
        screen.keepAwake(playing)
        focus.update(playing)
        pip.update(playing && session.item?.pip == true, session.videoSize)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveLink(intent)
    }

    private fun receiveLink(intent: Intent?) {
        intent?.data?.takeIf { it.scheme == "aiostreams" }?.let { receiveLink(it.toString()) }
    }

    private fun receiveLink(url: String) {
        links += url
        sendLinks()
    }

    private fun sendLinks() {
        while (linksReady && links.isNotEmpty()) {
            bridge.send(buildJsonObject {
                put("type", "link")
                put("url", links.removeFirst())
            })
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        players.save(outState)
    }

    private fun sendMpvConfig() = bridge.send(buildJsonObject {
        put("type", "mpv-config")
        put("text", engine.configFile.takeIf { it.exists() }?.readText().orEmpty())
    })

    private fun setFullscreen(on: Boolean) {
        screen.setFullscreen(on)
        bridge.send(buildJsonObject {
            put("type", "fullscreen")
            put("value", on)
        })
    }

    /** Any type: subtitle formats rarely carry a MIME type the picker knows, and the page checks the name. */
    private fun chooseFiles(multiple: Boolean, callback: ValueCallback<Array<Uri>>) {
        picked?.onReceiveValue(null)
        picked = callback
        val intent = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        try {
            pickFiles.launch(intent)
        } catch (_: ActivityNotFoundException) {
            picked = null
            callback.onReceiveValue(null)
        }
    }

    /** Asked on the first download, whose progress shows in one. */
    private fun askForNotifications() {
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED
        ) {
            notifications.launch(permission)
        }
    }

    /** Kept by the app, as the page's storage goes with the address it loads from. */
    private fun deviceId(): String {
        val saved = getSharedPreferences("device", MODE_PRIVATE)
        return saved.getString("id", null)
            ?: UUID.randomUUID().toString().replace("-", "").also { saved.edit().putString("id", it).apply() }
    }

    private fun deviceName(): String =
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL

    override fun onResume() {
        super.onResume()
        updater.onResume()
    }

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
        updater.release()
        Downloads.queue(this).send = null
        MediaController.releaseFuture(controller)
        PlaybackService.player = null
        focus.release()
        engine.release()
        web.destroy()
        super.onDestroy()
    }
}
