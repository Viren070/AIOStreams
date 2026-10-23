package io.github.viren070.aiostreams

import android.Manifest
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.app.NotificationManager
import android.app.UiModeManager
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.MediaStore
import android.provider.Settings
import android.text.format.Formatter
import android.util.Log
import android.hardware.input.InputManager
import android.view.InputDevice
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
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
import io.github.viren070.aiostreams.playback.Change
import io.github.viren070.aiostreams.playback.PlayerChannel
import io.github.viren070.aiostreams.playback.PlayerProtocol
import io.github.viren070.aiostreams.playback.Sound
import `is`.xyz.mpv.AudioEncoder
import java.io.File
import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** The video beneath, the page over it, and the bridge between them. */
class MainActivity : ComponentActivity() {
    private lateinit var web: CompletingWebView
    private lateinit var bridge: AppBridge
    private lateinit var playback: Playback
    private lateinit var player: PlayerChannel
    private lateinit var downloads: DownloadChannel
    private lateinit var updater: Updater
    private lateinit var pip: PictureInPicture
    private lateinit var focus: AudioFocus
    private lateinit var passthrough: Passthrough
    private val youtube = YouTube { message -> runOnUiThread { bridge.send(message) } }
    private lateinit var controller: ListenableFuture<MediaController>
    private val screen = PlayerWindow(this)
    private val levels by lazy { Levels(this) }
    private val watchNext by lazy { WatchNext(this) }
    private val trustedRoots by lazy { MpvEngine.trustedRoots(this).toByteArray() }
    /** Run once the notification question is answered, either way. */
    private var afterNotifications: (() -> Unit)? = null
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        val next = afterNotifications
        afterNotifications = null
        next?.invoke()
    }
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
    private val voice = Voice(this) { bridge.send(it) }
    private lateinit var frameRates: FrameRateMatch
    /** False when onCreate only showed the outdated WebView message. */
    private val started get() = ::bridge.isInitialized
    /** The page's renderer ended, leaving a web view that can't be used. */
    private var pageGone = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!webViewUsable(this)) return setContentView(outdatedWebView(this))
        // The page is dark whatever the system's theme, so the bars keep light icons.
        val dark = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { true }
        enableEdgeToEdge(dark, dark)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.INSPECTABLE)

        playback = Playback(this) { engine ->
            if (::bridge.isInitialized) bridge.send(buildJsonObject {
                put("type", "player-engine")
                put("name", engine)
            })
        }
        // Edge to edge: the page keeps clear of the system bars with its own safe-area insets.
        web = CompletingWebView(this, onTv())
        setContentView(FrameLayout(this).apply {
            addView(playback.stage, MATCH_PARENT, MATCH_PARENT)
            addView(web, MATCH_PARENT, MATCH_PARENT)
        })

        val app = WebApp(BuildConfig.WEB_URL.ifEmpty { null })
        app.configure(web, ::chooseFiles, players::open, ::onRendererGone) { path ->
            if (::player.isInitialized) player.thumbnail(path) else null
        }
        val queue = Downloads.queue(this)
        queue.send = { message -> runOnUiThread { bridge.send(message) } }
        downloads = DownloadChannel(queue, onAdd = { askForNotifications() })
        frameRates = FrameRateMatch(
            this,
            hold = {
                val playing = !player.paused
                if (playing) player.change(Change(paused = true))
                playing
            },
            resume = { player.change(Change(paused = false)) },
        )
        passthrough = Passthrough(this) { player.outputChanged() }
        player = PlayerChannel(
            playback.engine,
            send = { bridge.send(it) },
            isLocal = queue::isLocal,
            subtitles = File(cacheDir, "subtitles"),
            beforeLoad = { playback.beforeLoad(player) },
            fallBack = { playback.fallBack(player) },
            frameRate = frameRates::match,
            showVideo = playback::showVideo,
            passthrough = passthrough::supported,
            trustedRoots = { trustedRoots },
        )
        gamepads = hasGamepad()
        getSystemService(InputManager::class.java).registerInputDeviceListener(controllers, null)
        val identity = AppIdentity(
            BuildConfig.VERSION_NAME,
            deviceName(),
            deviceId(),
            onTv(),
            voice.available,
            gamepads,
            PictureInPicture.supported(this),
        )
        bridge = AppBridge(web, app.origins, identity, ::onMessage)
        updater = Updater(this, ::askForNotifications) { bridge.send(it) }
        pip = PictureInPicture(this, playback.stage)
        focus = AudioFocus(
            this,
            pause = { player.change(Change(paused = true)) },
            resume = { player.change(Change(paused = false)) },
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
                put("ac3Encoder", AudioEncoder.has("ac3"))
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
            "player-settings" -> {
                player.setSettings(PlayerProtocol.settings(message))
                message["frameRate"]?.jsonPrimitive?.booleanOrNull?.let { frameRates.enabled = it }
                message["tunneling"]?.jsonPrimitive?.booleanOrNull?.let { playback.tunneling = it }
                message["dolbyVision"]?.jsonPrimitive?.booleanOrNull?.let { playback.dolbyVision = it }
                playback.sound = Sound(
                    dialogueBoost = message["dialogueBoost"]?.jsonPrimitive?.intOrNull ?: 0,
                    nightMode = message["nightMode"]?.jsonPrimitive?.booleanOrNull == true,
                    ac3Encode = message["ac3Encode"]?.jsonPrimitive?.booleanOrNull == true,
                )
            }
            "youtube-resolve" -> youtube.resolve(
                message["request"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                message["id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            )
            "keyboard-completions" -> web.showCompletions(
                (message["items"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty(),
            )
            "watch-next" -> watchNext.publish((message["items"] as? JsonArray)?.filterIsInstance<JsonObject>().orEmpty())
            "voice-search" -> voice.listen()
            "voice-cancel" -> voice.cancel()
            "download-folder" -> runOnUiThread(::chooseDownloadFolder)
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
            "crash-report" -> Thread {
                val report = runCatching { Crashes.last(this) }.getOrNull()
                runOnUiThread {
                    bridge.send(buildJsonObject {
                        put("type", "crash-report")
                        if (report != null) {
                            put("at", report.at)
                            put("summary", report.summary)
                            put("details", report.details)
                            if (report.page) put("page", true)
                        }
                    })
                }
            }.start()
            "crash-seen" -> message["at"]?.jsonPrimitive?.longOrNull?.let { Crashes.seen(this, it) }
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
                val note = getString(if (saved.isSuccess) R.string.file_saved else R.string.file_not_saved, name)
                Toast.makeText(this, note, Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    private fun chooseDownloadFolder() {
        val folders = Downloads.folders(this)
        if (folders.isEmpty()) return
        val storage = getSystemService(StorageManager::class.java)
        val labels = folders.map { folder ->
            getString(
                R.string.download_folder_free,
                storage.getStorageVolume(folder)?.getDescription(this) ?: folder.path,
                Formatter.formatShortFileSize(this, folder.usableSpace),
            )
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.download_folder_title)
            .setSingleChoiceItems(labels.toTypedArray(), folders.indexOf(Downloads.folder(this))) { dialog, which ->
                Downloads.setFolder(this, folders[which])
                dialog.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
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

    /** Asked on the first download, whose progress shows in one, and before an update. */
    private fun askForNotifications(then: () -> Unit = {}) {
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        ) {
            return then()
        }
        afterNotifications = then
        notifications.launch(permission)
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

    /**
     * Starts the page again in a new activity, once it shows: Android ends a
     * renderer behind other apps to free memory, and would end a new one too.
     */
    private fun onRendererGone(crashed: Boolean) {
        val shown = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        Crashes.rendererGone(this, crashed, shown)
        pageGone = true
        bridge.close()
        (web.parent as? ViewGroup)?.removeView(web)
        if (shown) recreate()
    }

    override fun onStart() {
        super.onStart()
        if (pageGone) recreate()
    }

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
            player.change(Change(paused = true))
        }
    }

    override fun onStop() {
        super.onStop()
        if (!started) return
        val background = player.session.item?.background == true
        if (!isChangingConfigurations && !isInPictureInPictureMode && !background) player.change(Change(paused = true))
    }

    override fun onDestroy() {
        if (!started) return super.onDestroy()
        getSystemService(InputManager::class.java).unregisterInputDeviceListener(controllers)
        updater.release()
        voice.release()
        Downloads.queue(this).send = null
        MediaController.releaseFuture(controller)
        PlaybackService.player = null
        focus.release()
        passthrough.release()
        youtube.release()
        playback.engine.release()
        web.destroy()
        super.onDestroy()
    }
}
