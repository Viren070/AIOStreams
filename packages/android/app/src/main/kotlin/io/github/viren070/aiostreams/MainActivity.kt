package io.github.viren070.aiostreams

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.app.NotificationManager
import android.app.UiModeManager
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.speech.RecognizerIntent
import android.util.Log
import android.hardware.input.InputManager
import android.view.InputDevice
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
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
import io.github.viren070.aiostreams.mpv.MpvEngine
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
    private lateinit var playback: Playback
    private lateinit var player: PlayerChannel
    private lateinit var downloads: DownloadChannel
    private lateinit var updater: Updater
    private lateinit var pip: PictureInPicture
    private lateinit var focus: AudioFocus
    private lateinit var controller: ListenableFuture<MediaController>
    private val screen = PlayerWindow(this)
    private val levels by lazy { Levels(this) }
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    /** A save waiting on storage access, run either way so a refusal reports as a failure. */
    private var unsaved: (() -> Unit)? = null
    private val storage = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        val save = unsaved
        unsaved = null
        save?.invoke()
    }
    private val players = ExternalPlayers(this, ::receiveLink)
    /** `aiostreams://` links, held until the page listens. */
    private val links = ArrayDeque<String>()
    private var linksReady = false
    private var picked: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        picked?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data))
        picked = null
    }
    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        sendHeard(heard.takeIf { result.resultCode == RESULT_OK })
    }
    private lateinit var frameRates: FrameRateMatch
    /** False when onCreate only showed the outdated WebView message. */
    private val started get() = ::bridge.isInitialized

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!webViewUsable(this)) return setContentView(outdatedWebView(this))
        enableEdgeToEdge()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.INSPECTABLE)

        playback = Playback(this) { engine ->
            if (::bridge.isInitialized) bridge.send(buildJsonObject {
                put("type", "player-engine")
                put("name", engine)
            })
        }
        // Edge to edge: the page keeps clear of the system bars with its own safe-area insets.
        web = WebView(this)
        setContentView(FrameLayout(this).apply {
            addView(playback.stage, MATCH_PARENT, MATCH_PARENT)
            addView(web, MATCH_PARENT, MATCH_PARENT)
        })

        val app = WebApp(BuildConfig.WEB_URL.ifEmpty { null })
        app.configure(web, ::chooseFiles, players::open)
        val queue = Downloads.queue(this)
        queue.send = { message -> runOnUiThread { bridge.send(message) } }
        downloads = DownloadChannel(queue, onAdd = ::askForNotifications)
        frameRates = FrameRateMatch(
            this,
            hold = {
                val playing = !player.paused
                if (playing) playback.engine.setProperty("pause", "yes")
                playing
            },
            resume = { playback.engine.setProperty("pause", "no") },
        )
        player = PlayerChannel(
            playback.engine,
            send = { bridge.send(it) },
            isLocal = queue::isLocal,
            subtitles = File(cacheDir, "subtitles"),
            beforeLoad = { playback.beforeLoad(player) },
            fallBack = { playback.fallBack(player) },
            frameRate = frameRates::match,
            showVideo = playback::showVideo,
        )
        gamepads = hasGamepad()
        getSystemService(InputManager::class.java).registerInputDeviceListener(controllers, null)
        val identity = AppIdentity(
            BuildConfig.VERSION_NAME,
            deviceName(),
            deviceId(),
            onTv(),
            canListen(),
            gamepads,
            PictureInPicture.supported(this),
        )
        bridge = AppBridge(web, app.origins, identity, ::onMessage)
        updater = Updater(this) { bridge.send(it) }
        pip = PictureInPicture(this, playback.stage)
        focus = AudioFocus(
            this,
            pause = { playback.engine.setProperty("pause", "yes") },
            resume = { playback.engine.setProperty("pause", "no") },
        )
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

        // The page's own Back closes what is open, leaves the player and goes back, and
        // says `exit` on its first page.
        onBackPressedDispatcher.addCallback(this) {
            when {
                bridge.connected -> bridge.send(buildJsonObject { put("type", "back") })
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
                put("mpv", playback.engine.property("mpv-version"))
                put("ffmpeg", playback.engine.property("ffmpeg-version"))
                put("player", playback.engine.description)
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
            "exit" -> moveTaskToBack(true)
            "links-ready" -> {
                linksReady = true
                sendLinks()
            }
            "player-engine" -> message["name"]?.jsonPrimitive?.contentOrNull?.let { playback.choose(it, player) }
            "player-retry" -> message["name"]?.jsonPrimitive?.contentOrNull?.let { playback.retry(it, player) }
            "player-options" -> {
                message["frameRate"]?.jsonPrimitive?.booleanOrNull?.let { frameRates.enabled = it }
                message["tunneling"]?.jsonPrimitive?.booleanOrNull?.let { playback.tunneling = it }
            }
            "voice-search" -> listen()
            "save-file" -> saveFile(
                message["name"]?.jsonPrimitive?.contentOrNull ?: "aiostreams.txt",
                message["mime"]?.jsonPrimitive?.contentOrNull ?: "text/plain",
                message["text"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            )
            "mpv-config" -> sendMpvConfig()
            "mpv-config-save" -> {
                MpvEngine.configFile(this).writeText(message["text"]?.jsonPrimitive?.content.orEmpty())
                (playback.engine as? MpvEngine)?.reloadConfig()
                sendMpvConfig()
            }
            "diagnostics" -> {
                val web = message["web"]?.jsonPrimitive?.contentOrNull
                val server = message["server"]?.jsonPrimitive?.contentOrNull
                // Reading the log takes a moment.
                Thread {
                    val text = diagnostics(this, playback.engine, web, server)
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

    /** Into the shared Downloads folder, which needs storage access before Android 10. */
    private fun saveFile(name: String, mime: String, text: String) {
        val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED
        ) {
            unsaved = { writeFile(name, mime, text) }
            storage.launch(permission)
            return
        }
        writeFile(name, mime, text)
    }

    private fun writeFile(name: String, mime: String, text: String) {
        Thread {
            val saved = runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: error("no Downloads entry")
                    contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                        ?: error("no Downloads stream")
                } else {
                    val folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    folder.mkdirs()
                    File(folder, name).writeText(text)
                }
            }
            saved.exceptionOrNull()?.let { Log.e("save-file", "saving $name", it) }
            runOnUiThread {
                val note = if (saved.isSuccess) "Saved $name to Downloads" else "Couldn't save $name"
                Toast.makeText(this, note, Toast.LENGTH_LONG).show()
            }
        }.start()
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
        put("text", MpvEngine.configFile(this@MainActivity).takeIf { it.exists() }?.readText().orEmpty())
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

    private fun listen() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            listen.launch(intent)
        } catch (_: ActivityNotFoundException) {
            sendHeard(null)
        }
    }

    private var gamepads = false

    private val controllers = object : InputManager.InputDeviceListener {
        override fun onInputDeviceAdded(deviceId: Int) = update()
        override fun onInputDeviceRemoved(deviceId: Int) = update()
        override fun onInputDeviceChanged(deviceId: Int) = update()

        private fun update() {
            val now = hasGamepad()
            if (now == gamepads) return
            gamepads = now
            bridge.send(buildJsonObject {
                put("type", "gamepads")
                put("connected", now)
            })
        }
    }

    /** As the web view counts gamepads: joystick devices. */
    private fun hasGamepad() = InputDevice.getDeviceIds().any { id ->
        InputDevice.getDevice(id)?.let { !it.isVirtual && it.supportsSource(InputDevice.SOURCE_JOYSTICK) } == true
    }

    private fun canListen() =
        packageManager.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isNotEmpty()

    private fun sendHeard(text: String?) = bridge.send(buildJsonObject {
        put("type", "voice-result")
        put("text", text)
    })

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
    private fun onTv() =
        getSystemService(UiModeManager::class.java).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION

    private fun deviceId(): String {
        val saved = getSharedPreferences("device", MODE_PRIVATE)
        return saved.getString("id", null)
            ?: UUID.randomUUID().toString().replace("-", "").also { saved.edit().putString("id", it).apply() }
    }

    private fun deviceName(): String =
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL

    override fun onResume() {
        super.onResume()
        if (started) updater.onResume()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (started) pip.onUserLeaveHint()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        bridge.send(buildJsonObject {
            put("type", "pip")
            put("value", isInPictureInPictureMode)
        })
        // Closing the window, rather than opening it full size, stops playback.
        if (!isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED) {
            playback.engine.setProperty("pause", "yes")
        }
    }

    override fun onStop() {
        super.onStop()
        if (!started) return
        val background = player.session.item?.background == true
        if (!isChangingConfigurations && !isInPictureInPictureMode && !background) playback.engine.setProperty("pause", "yes")
    }

    override fun onDestroy() {
        if (!started) return super.onDestroy()
        getSystemService(InputManager::class.java).unregisterInputDeviceListener(controllers)
        updater.release()
        Downloads.queue(this).send = null
        MediaController.releaseFuture(controller)
        PlaybackService.player = null
        focus.release()
        playback.engine.release()
        web.destroy()
        super.onDestroy()
    }
}
