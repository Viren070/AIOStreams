package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.graphics.Rect
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaLibraryInfo
import androidx.media3.common.MimeTypes
import androidx.media3.common.ParserException
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceUtil
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.UnrecognizedInputFormatException
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.video.VideoFrameMetadataListener
import androidx.media3.extractor.metadata.Chapter
import io.github.viren070.aiostreams.mpv.MpvEngine
import io.github.viren070.aiostreams.playback.Engine
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * ExoPlayer, driven in mpv's terms. libass draws ASS subtitles over the video;
 * the player's subtitle view draws the rest.
 */
@OptIn(UnstableApi::class)
class ExoEngine(private val context: Context) :
    Engine, Player.Listener, AnalyticsListener, VideoFrameMetadataListener {
    private val main = Handler(Looper.getMainLooper())
    private val loader = Executors.newSingleThreadExecutor { Thread(it, "exo-loader") }
    private val data = DefaultDataSource.Factory(context, DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true))
    private val ass = AssSurface(context) { MpvEngine.fallbackFont(context) }
    private val player: ExoPlayer
    private val tracks = ExoTracks()
    private val style = SubtitleStyle()
    private val reported = ConcurrentHashMap<String, JsonElement>()
    private val decoders = ConcurrentHashMap<String, String>()
    private var listener: Engine.Listener? = null
    private var stage: Stage? = null
    private var layout = AssLayout()
    private var sentLayout: AssLayout? = null

    // The file playing and what the page asked of it.
    private var url: String? = null
    private var options = TrackOptions(emptyMap())
    private var loaded = false
    private var chosen = false
    private var seeking = false
    /** A load or seek waits for its first frame, which mpv reports as `playback-restart`. */
    private var restarting = false
    private var volume = 100.0
    private var muted = false
    private val externals = mutableListOf<ExternalSubtitle>()
    private val texts = TextTracks()
    private var shownCues: List<Cue> = emptyList()

    // Read on the playback thread too.
    @Volatile
    private var external: ExternalSubtitle? = null

    /** The text subtitle the engine times itself, rather than the player. */
    @Volatile
    private var text: TextTimeline? = null

    @Volatile
    private var readBack: String? = null

    @Volatile
    private var delayUs = 0L

    @Volatile
    private var lastFrameUs = 0L

    @Volatile
    private var lastFrameAtNs = 0L

    @Volatile
    private var passthrough = false

    private var tunneling = false

    init {
        val sources = DefaultMediaSourceFactory(data, SubtitleExtractors({ readBack }) { SubtitleSink(ass.sink(), texts.sink()) })
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioOutputPlaybackParameters: Boolean,
            ): AudioSink? = super.buildAudioSink(context, enableFloatOutput, enableAudioOutputPlaybackParameters)
                ?.let { PassthroughSink(it) { passthrough } }
        }
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
        val audio = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()
        player = ExoPlayer.Builder(context, renderers, sources)
            // The app keeps audio focus and pauses for noise itself.
            .setAudioAttributes(audio, false)
            .setHandleAudioBecomingNoisy(false)
            .build()
        player.addListener(this)
        player.addAnalyticsListener(this)
        player.setVideoFrameMetadataListener(this)
    }

    override val description = "ExoPlayer (Media3 ${MediaLibraryInfo.VERSION})"

    override fun start(listener: Engine.Listener) {
        this.listener = listener
        report("idle-active", true)
        report("pause", false)
        report("volume", volume)
        report("volume-max", 100.0)
        report("mute", false)
        report("speed", 1.0)
        report("aid", "no")
        report("sid", "no")
        report("track-list", JsonArray(emptyList()))
        report("chapter-list", JsonArray(emptyList()))
    }

    override fun createView(context: Context): View = Stage(context, ::onStageLayout).also { stage ->
        this.stage = stage
        stage.addLayer(ass.view)
        style.apply(stage.subtitles)
        player.setVideoSurfaceView(stage.video)
    }

    override fun command(args: List<String>) {
        main.post { runCatching { run(args) }.onFailure { Log.w(TAG, "${args.firstOrNull()} failed", it) } }
    }

    override fun setProperty(name: String, value: String) {
        main.post { set(name, value) }
    }

    override fun property(name: String): String? = when (name) {
        "hwdec-current" -> decoders["video"]
        else -> (reported[name] as? JsonPrimitive)?.content
    }

    override fun stats(): JsonObject = onMain {
        buildJsonObject {
            put("engine", "exoplayer")
            for ((type, name) in decoders) put("${type}Decoder", name)
            player.videoDecoderCounters?.let { counters ->
                counters.ensureUpdated()
                put("renderedFrames", counters.renderedOutputBufferCount)
                put("droppedFrames", counters.droppedBufferCount)
                put("skippedFrames", counters.skippedOutputBufferCount)
                put("maxConsecutiveDropped", counters.maxConsecutiveDroppedBufferCount)
                put("droppedToKeyframe", counters.droppedToKeyframeCount)
            }
            for ((key, value) in ass.stats()) put(key, value)
        }
    }

    override fun release() {
        main.post {
            player.release()
            ass.release()
            loader.shutdown()
        }
    }

    private fun run(args: List<String>) {
        when (args[0]) {
            "loadfile" -> load(args[1], args.getOrNull(4).orEmpty())
            "sub-add" -> addSubtitle(args[1], args.getOrNull(2), args.getOrNull(3), args.getOrNull(4))
            "sub-remove" -> removeSubtitle(args.getOrNull(1)?.toIntOrNull() ?: selectedSubtitle())
            "seek" -> seek(args[1].toDouble(), args.getOrNull(2) ?: "relative")
            "stop" -> stop()
            "frame-step", "frame-back-step" -> {
                player.playWhenReady = false
                val frameMs = 1000 / (tracks.format("video")?.frameRate?.takeIf { it > 0 } ?: 24f)
                val step = if (args[0] == "frame-step") frameMs else -frameMs
                seekTo(player.currentPosition + step.toLong(), SeekParameters.EXACT)
            }
            "set" -> set(args[1], args[2])
            "cycle" -> when (args[1]) {
                "pause" -> set("pause", if (player.playWhenReady) "yes" else "no")
                "mute" -> set("mute", if (muted) "no" else "yes")
                "sub-visibility" -> set("sub-visibility", if (style.visible) "no" else "yes")
            }
            "add" -> {
                val step = args.getOrNull(2)?.toDoubleOrNull() ?: 1.0
                val now = when (args[1]) {
                    "volume" -> volume
                    "speed" -> player.playbackParameters.speed.toDouble()
                    "sub-delay" -> delayUs / 1e6
                    "sub-scale" -> style.scale
                    "sub-pos" -> style.position
                    else -> return
                }
                set(args[1], (now + step).toString())
            }
            // The rest has no meaning here: the stats overlay and the queue are mpv's.
        }
    }

    private fun set(name: String, value: String) {
        when (name) {
            "pause" -> player.playWhenReady = value != "yes"
            "volume" -> {
                volume = value.toDoubleOrNull()?.coerceIn(0.0, 100.0) ?: volume
                applyVolume()
                report("volume", volume)
            }
            "mute" -> {
                muted = value == "yes"
                applyVolume()
                report("mute", muted)
            }
            "speed" -> value.toFloatOrNull()?.let { player.playbackParameters = PlaybackParameters(it) }
            "aid" -> selectTrack("audio", value.toIntOrNull())
            "sid" -> selectSubtitle(value.toIntOrNull())
            "sub-delay" -> {
                delayUs = ((value.toDoubleOrNull() ?: 0.0) * 1e6).toLong()
                redrawSubtitles()
            }
            "time-pos" -> value.toDoubleOrNull()?.let { seek(it, "absolute") }
            // Applies from the next audio track it picks.
            "audio-spdif" -> passthrough = value.isNotEmpty()
            "keepaspect" -> stage?.keepAspect = value == "yes"
            "panscan" -> stage?.panscan = value.toDoubleOrNull() ?: 0.0
            else -> if (style.set(name, value)) {
                stage?.let { style.apply(it.subtitles) }
                updateLayout()
                showSubtitles()
            }
        }
    }

    private fun load(url: String, rawOptions: String) {
        if (this.url != null) listener?.onEnded("stop", null, null)
        val values = rawOptions.split(',').filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
        this.url = url
        options = TrackOptions(values)
        loaded = false
        chosen = false
        restarting = true
        clearExternals()
        ass.reset()
        texts.reset()
        readBack = if (options.sid == "no") null else SubtitleExtractors.ANY_TRACK
        listener?.onEvent("start-file")
        report("idle-active", false)
        report("chapter-list", JsonArray(emptyList()))
        report("container-fps", null)
        // Close to what mpv picks, so the first selection rarely changes.
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverrides()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, options.sid == "no")
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .setPreferredAudioLanguages(*options.alang.toTypedArray())
            .setPreferredTextLanguages(*options.slang.toTypedArray())
            .build()
        val start = values["start"]?.toDoubleOrNull()?.let { (it * 1000).toLong() } ?: 0L
        player.setMediaItem(MediaItem.fromUri(url), start)
        player.prepare()
    }

    private fun stop() {
        if (url == null) return
        url = null
        player.stop()
        player.clearMediaItems()
        clearExternals()
        listener?.onEnded("stop", null, null)
        report("idle-active", true)
    }

    private fun seek(target: Double, flags: String) {
        val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        val parts = flags.split('+')
        val ms = when {
            "absolute-percent" in parts -> (duration * target / 100).toLong()
            "relative-percent" in parts -> player.currentPosition + (duration * target / 100).toLong()
            "absolute" in parts -> (target * 1000).toLong()
            else -> player.currentPosition + (target * 1000).toLong()
        }
        seekTo(ms, if ("keyframes" in parts) SeekParameters.CLOSEST_SYNC else SeekParameters.EXACT)
    }

    private fun seekTo(ms: Long, parameters: SeekParameters) {
        if (url == null) return
        player.setSeekParameters(parameters)
        player.seekTo(ms.coerceAtLeast(0))
        seeking = true
        restarting = true
        report("seeking", true)
        listener?.onEvent("seek")
        reportPosition()
    }

    private fun applyVolume() {
        player.volume = if (muted) 0f else (volume / 100).toFloat()
    }

    private fun selectTrack(type: String, id: Int?) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .also { tracks.select(it, type, id) }
            .build()
    }

    /** Ids past the file's own are the page's added files, as with mpv. */
    private fun selectSubtitle(id: Int?) {
        external = externals.find { it.id == id }
        selectTrack("sub", id.takeIf { external == null })
        reportTracks()
        showSubtitles()
    }

    private fun selectedSubtitle(): Int? = external?.id ?: tracks.selected("sub")

    private fun addSubtitle(url: String, flags: String?, title: String?, lang: String?) {
        externals.find { it.url == url }?.let { found ->
            if (flags == "select") selectSubtitle(found.id)
            return
        }
        val file = this.url
        loader.execute {
            runCatching {
                val bytes = read(url)
                main.post {
                    if (this.url != file) return@post
                    val id = tracks.count("sub") + externals.size + 1
                    val added = ExternalSubtitle.parse(id, url, title, lang, bytes)
                    added.script?.let { ass.addScript(added.key, it) }
                    externals += added
                    if (flags == "select") selectSubtitle(id) else reportTracks()
                }
            }.onFailure { Log.w(TAG, "couldn't add the subtitle", it) }
        }
    }

    private fun removeSubtitle(id: Int?) {
        val removed = externals.find { it.id == id } ?: return
        externals -= removed
        ass.removeScript(removed.key)
        if (external == removed) selectSubtitle(null) else reportTracks()
    }

    private fun clearExternals() {
        external = null
        externals.clear()
    }

    private fun read(url: String): ByteArray {
        val source = data.createDataSource()
        return try {
            source.open(DataSpec(Uri.parse(url)))
            DataSourceUtil.readToEnd(source)
        } finally {
            source.close()
        }
    }

    private fun showSubtitles() {
        val added = external
        val format = tracks.format("sub")
        val id = format?.id?.substringAfter(':')
        ass.select(
            when {
                !style.visible -> null
                added != null -> added.key.takeIf { added.script != null }
                format != null && isAss(format) -> id
                else -> null
            },
        )
        text = when {
            !style.visible -> null
            added != null -> added.text
            format != null && !isAss(format) -> id?.let(texts::get)
            else -> null
        }
        if (chosen) readBack = id.takeIf { style.visible && added == null }
        shownCues = emptyList()
        stage?.subtitles?.setCues(emptyList())
        showCues(lastFrameUs)
    }

    private fun redrawSubtitles() {
        ass.invalidate()
        showCues(lastFrameUs)
    }

    // Each video frame, as it is handed to the screen: the subtitles follow the picture.
    override fun onVideoFrameAboutToBeRendered(
        presentationTimeUs: Long,
        releaseTimeNs: Long,
        format: Format,
        mediaFormat: MediaFormat?,
    ) {
        lastFrameUs = presentationTimeUs
        lastFrameAtNs = System.nanoTime()
        ass.render(presentationTimeUs - delayUs, releaseTimeNs)
        if (text != null) main.post { showCues(presentationTimeUs) }
    }

    fun setTunneling(on: Boolean) = main.post {
        val selector = player.trackSelector as? DefaultTrackSelector ?: return@post
        selector.setParameters(selector.buildUponParameters().setTunnelingEnabled(on))
        tunneling = on
        updateClock()
    }

    // Tunneled frames skip the frame callbacks, so subtitles follow the playback clock.
    private val clock = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!tunneling || !player.isPlaying) return
            if (System.nanoTime() - lastFrameAtNs > FRAMES_STOPPED_NS) {
                val us = player.currentPosition * 1000
                lastFrameUs = us
                ass.render(us - delayUs, frameTimeNanos)
                showCues(us)
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun updateClock() {
        Choreographer.getInstance().removeFrameCallback(clock)
        if (tunneling && player.isPlaying) Choreographer.getInstance().postFrameCallback(clock)
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        if (format.frameRate > 0) report("container-fps", format.frameRate.toDouble())
    }

    private fun showCues(frameUs: Long) {
        val cues = text?.cuesAt(frameUs - delayUs) ?: return
        if (cues == shownCues) return
        shownCues = cues
        stage?.subtitles?.setCues(cues)
    }

    override fun onCues(cueGroup: CueGroup) {
        if (text == null && external == null) stage?.subtitles?.setCues(if (style.visible) cueGroup.cues else emptyList())
    }

    private fun onStageLayout(width: Int, height: Int, video: Rect) {
        layout = layout.copy(stageWidth = width, stageHeight = height, video = video)
        updateLayout()
    }

    private fun updateLayout() {
        val next = layout.copy(
            scale = style.scale,
            position = style.position,
            forceMargins = style.forceMargins,
            style = style.assStyle(),
        )
        layout = next
        if (next == sentLayout) return
        sentLayout = next
        ass.setLayout(next)
    }

    override fun onPlaybackStateChanged(state: Int) {
        when (state) {
            Player.STATE_READY -> {
                if (!loaded) {
                    loaded = true
                    listener?.onEvent("file-loaded")
                    report("duration", player.duration.takeIf { it != C.TIME_UNSET }?.let { it / 1000.0 })
                }
                if (restarting) {
                    restarting = false
                    seeking = false
                    report("seeking", false)
                    listener?.onEvent("playback-restart")
                }
                report("paused-for-cache", false)
            }
            Player.STATE_BUFFERING -> if (loaded && !seeking) report("paused-for-cache", true)
            Player.STATE_ENDED -> {
                url = null
                listener?.onEnded("eof", null, null)
                report("idle-active", true)
            }
        }
        reportPosition()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        report("pause", !playWhenReady)
        updatePolling()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        updatePolling()
        updateClock()
    }

    override fun onPlaybackParametersChanged(parameters: PlaybackParameters) = report("speed", parameters.speed.toDouble())

    override fun onVideoSizeChanged(size: VideoSize) {
        stage?.videoSize = size
        if (size.width == 0 || size.height == 0) return
        layout = layout.copy(videoWidth = size.width, videoHeight = size.height)
        updateLayout()
        report("video-params", buildJsonObject {
            put("w", size.width)
            put("h", size.height)
            put("dw", (size.width * size.pixelWidthHeightRatio).toInt())
            put("dh", size.height)
            put("aspect", size.width * size.pixelWidthHeightRatio / size.height)
        })
    }

    override fun onTracksChanged(tracks: Tracks) {
        this.tracks.update(tracks)
        if (!chosen && !this.tracks.isEmpty()) {
            chosen = true
            undecodable(tracks)?.let { error ->
                url = null
                player.stop()
                listener?.onUnplayable(error)
                return
            }
            val audio = this.tracks.chooseAudio(options)
            val subtitle = this.tracks.chooseSubtitle(options, this.tracks.languageOfTrack("audio", audio))
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .also { this.tracks.select(it, "audio", audio) }
                .also { this.tracks.select(it, "sub", subtitle) }
                .build()
        }
        reportTracks()
        reportChapters()
        showSubtitles()
    }

    private fun reportTracks() {
        val added = externals.map { sub ->
            buildJsonObject {
                put("id", sub.id)
                put("type", "sub")
                sub.title?.let { put("title", it) }
                sub.lang?.let { put("lang", it) }
                put("codec", sub.codec)
                put("external", true)
                put("external-filename", sub.url)
                put("selected", sub == external)
            }
        }
        report("track-list", JsonArray(tracks.list() + added))
        report("aid", tracks.selected("audio")?.toString() ?: "no")
        report("sid", selectedSubtitle()?.toString() ?: "no")
    }

    /** The file's chapters, which Media3 gives every track's format. */
    private fun reportChapters() {
        val metadata = tracks.format("video")?.metadata ?: tracks.format("audio")?.metadata ?: return
        val chapters = (0 until metadata.length()).map(metadata::get).filterIsInstance<Chapter>().filterNot { it.isHidden }
        report("chapter-list", JsonArray(chapters.sortedBy { it.startTimeMs }.map { chapter ->
            buildJsonObject {
                put("title", chapter.title?.value.orEmpty())
                put("time", chapter.startTimeMs / 1000.0)
            }
        }))
    }

    override fun onPlayerError(error: PlaybackException) {
        url = null
        Log.w(TAG, "playback failed", error)
        report("idle-active", true)
        // mpv can't load a link that failed to either; anything else it may well play.
        if (error.errorCode !in LINK) return listener?.onUnplayable(unplayable(error)) ?: Unit
        val (message, cause) = failureOf(error)
        listener?.onEnded("error", message, cause)
    }

    override fun onVideoDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        decoders["video"] = decoderName
    }

    override fun onAudioDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        decoders["audio"] = decoderName
    }

    private val poll = object : Runnable {
        override fun run() {
            reportPosition()
            main.postDelayed(this, POLL_MS)
        }
    }

    private fun updatePolling() {
        main.removeCallbacks(poll)
        if (player.isPlaying) main.postDelayed(poll, POLL_MS)
        reportPosition()
    }

    private fun reportPosition() {
        if (url == null) return
        report("time-pos", player.currentPosition / 1000.0)
        report("demuxer-cache-time", player.bufferedPosition / 1000.0)
    }

    private fun report(name: String, value: Any?) {
        val element = when (value) {
            null -> JsonNull
            is JsonElement -> value
            is Boolean -> JsonPrimitive(value)
            is Number -> JsonPrimitive(value)
            else -> JsonPrimitive(value.toString())
        }
        if (reported.put(name, element) == element) return
        listener?.onProperty(name, element)
    }

    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: Result<T>? = null
        val done = CountDownLatch(1)
        main.post {
            result = runCatching(block)
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
        return result?.getOrThrow() ?: error("the player didn't answer")
    }

    private class PassthroughSink(sink: AudioSink, private val on: () -> Boolean) : ForwardingAudioSink(sink) {
        private fun allowed(format: Format) = on() || format.sampleMimeType == MimeTypes.AUDIO_RAW

        override fun supportsFormat(format: Format) = allowed(format) && super.supportsFormat(format)

        override fun getFormatSupport(format: Format) =
            if (allowed(format)) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED
    }

    private companion object {
        const val TAG = "exo"
        const val POLL_MS = 250L
        const val FRAMES_STOPPED_NS = 100_000_000L

        /** Errors loading the link. */
        val LINK = 2000..2999

        /** mpv's words for a link that failed to load, which the page knows, and why it failed. */
        fun failureOf(error: PlaybackException): Pair<String, String> {
            val causes = generateSequence<Throwable>(error) { it.cause }.toList()
            causes.filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.let {
                return "loading failed" to "HTTP error ${it.responseCode} ${it.responseMessage.orEmpty()}".trim()
            }
            return "loading failed" to when (error.errorCode) {
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "could not connect to the server"
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "the server took too long to answer"
                else -> error.errorCodeName.removePrefix("ERROR_CODE_IO_").lowercase().replace('_', ' ')
            }
        }

        /** Why ExoPlayer can't play the file, with Media3's own reason. */
        fun unplayable(error: PlaybackException): String {
            undecodable(error)?.let { return it }
            val causes = generateSequence<Throwable>(error) { it.cause }.toList()
            if (causes.any { it is UnrecognizedInputFormatException }) return "ExoPlayer doesn't recognise this file's format"
            val reason = causes.filterIsInstance<ParserException>().firstNotNullOfOrNull { reasonOf(it) }
                ?: error.errorCodeName.removePrefix("ERROR_CODE_").lowercase().replace('_', ' ')
            return "ExoPlayer can't play this file: $reason"
        }

        /** The parser's message, in plain words where it's a known one. */
        fun reasonOf(error: ParserException): String? {
            // Media3 adds its fields to the message.
            val message = error.message.substringBefore("{contentIsMalformed").trim().takeIf { it.isNotEmpty() }
            val algorithm = message?.let { Regex("""^ContentCompAlgo (\d+) not supported""").find(it) }?.groupValues?.get(1)
            return when (algorithm) {
                null -> message
                "1" -> "it has bzip2-compressed tracks"
                "2" -> "it has LZO-compressed tracks"
                else -> "it has tracks compressed in a way it can't read"
            }
        }

        fun undecodable(error: PlaybackException): String? {
            if (error.errorCode !in DECODING) return null
            val format = (error as? ExoPlaybackException)?.rendererFormat
            return cantPlay(format, if (MimeTypes.isAudio(format?.sampleMimeType)) "audio" else "video")
        }

        /** The file's video, or all of its audio, which the device has no decoder for at all. */
        fun undecodable(tracks: Tracks): String? {
            for ((type, kind) in listOf(C.TRACK_TYPE_VIDEO to "video", C.TRACK_TYPE_AUDIO to "audio")) {
                val groups = tracks.groups.filter { it.type == type }
                val decodable = groups.any { group -> (0 until group.length).any { group.isTrackSupported(it, true) } }
                if (groups.isNotEmpty() && !decodable) return cantPlay(groups[0].getTrackFormat(0), kind)
            }
            return null
        }

        fun cantPlay(format: Format?, kind: String): String {
            val codec = when (format?.sampleMimeType) {
                // Not codecOf's hevc: the device may well play HEVC, just not this profile.
                MimeTypes.VIDEO_DOLBY_VISION ->
                    "Dolby Vision" + format.codecs?.split('.')?.getOrNull(1)?.toIntOrNull()?.let { " profile $it" }.orEmpty()
                else -> format?.let(ExoTracks::codecOf)?.takeIf { it.isNotEmpty() }
            }
            return "this device can't play ${listOfNotNull(codec, kind).joinToString(" ")}"
        }

        val DECODING = setOf(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        )
    }
}
