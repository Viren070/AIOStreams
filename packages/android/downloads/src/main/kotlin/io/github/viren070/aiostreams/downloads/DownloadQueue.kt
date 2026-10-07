package io.github.viren070.aiostreams.downloads

import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** One running download, for the notification. */
data class Running(val title: String, val bytes: Long, val total: Long?)

/**
 * Downloads the page hands over, as the desktop app's queue does: each runs on
 * its own thread, resumes from what is already on disk, and the queue outlives
 * the app. Everything but the workers runs on the queue's own thread.
 */
class DownloadQueue(
    private val stateFile: File,
    private val folder: File,
    userAgent: String,
    /** False while only a metered network is up. */
    private val unmetered: () -> Boolean,
) {
    /** Messages for the page, in the bridge's `download-state` and `download-progress` shapes. */
    @Volatile
    var send: ((JsonObject) -> Unit)? = null

    /** What runs, empty once nothing does. */
    @Volatile
    var onRunning: ((List<Running>) -> Unit)? = null

    private val thread = Executors.newSingleThreadScheduledExecutor { Thread(it, "downloads") }
    private val workers = Executors.newCachedThreadPool { Thread(it, "download") }
    private val fetcher = Fetcher(userAgent)
    private val json = Json { ignoreUnknownKeys = true }

    private var concurrent = 2
    private var wifiOnly = true
    private var jobs = mutableListOf<Job>()
    private val running = mutableMapOf<String, AtomicBoolean>()
    /** Removed while running: its files go once its worker lets go of them. */
    private val removing = mutableMapOf<String, Job>()
    private val speeds = mutableMapOf<String, Speed>()

    @Volatile
    private var localFiles = emptySet<String>()

    init {
        post {
            val saved = runCatching { json.decodeFromString<Saved>(stateFile.readText()) }.getOrNull() ?: Saved()
            concurrent = saved.concurrent
            wifiOnly = saved.wifiOnly
            jobs = saved.jobs.toMutableList()
            for (job in jobs) if (job.state == State.Downloading) job.state = State.Queued
            changed()
        }
        thread.scheduleWithFixedDelay(::reportProgress, PROGRESS_MS, PROGRESS_MS, TimeUnit.MILLISECONDS)
    }

    fun add(specs: List<DownloadSpec>) = post {
        for (spec in specs) {
            if (jobs.any { it.spec.id == spec.id }) continue
            val problem = runCatching { check(spec) }.exceptionOrNull()
            if (problem != null) {
                Log.w(TAG, "download ${spec.id}: ${problem.message}")
                send?.invoke(buildJsonObject {
                    put("type", "error")
                    put("message", "Can't download ${spec.title}: ${problem.message}")
                })
                continue
            }
            jobs += Job(spec, folder.path)
        }
        changed()
    }

    fun pause(id: String) = post {
        running[id]?.set(true)
        setState(id, { it != State.Done }, State.Paused)
        changed()
    }

    fun resume(id: String) = post {
        setState(id, { it == State.Paused }, State.Queued)
        changed()
    }

    fun retry(id: String) = post {
        setState(id, { it == State.Failed }, State.Queued)
        changed()
    }

    fun remove(id: String, files: Boolean) = post {
        val job = jobs.find { it.spec.id == id } ?: return@post
        jobs.remove(job)
        val stop = running[id]
        if (stop != null) {
            stop.set(true)
            if (files) removing[id] = job
        } else if (files) {
            deleteFiles(job)
        }
        changed()
    }

    fun list() = post(::changed)

    fun configure(concurrent: Int, wifiOnly: Boolean) = post {
        this.concurrent = concurrent.coerceIn(1, MAX_CONCURRENT)
        this.wifiOnly = wifiOnly
        changed()
    }

    /** The network changed, which may let downloads start or make them wait. */
    fun networkChanged() = post(::changed)

    /** A finished download's video or subtitle, which playback may open. */
    fun isLocal(path: String): Boolean = path in localFiles

    private fun post(block: () -> Unit) {
        thread.execute {
            try {
                block()
            } catch (e: Exception) {
                Log.e(TAG, "queue", e)
            }
        }
    }

    private fun setState(id: String, `when`: (State) -> Boolean, state: State) {
        jobs.find { it.spec.id == id && `when`(it.state) }?.let {
            it.state = state
            it.error = null
        }
    }

    private fun finished(id: String, error: Exception?) {
        running.remove(id)
        speeds.remove(id)
        removing.remove(id)?.let(::deleteFiles)
        val job = jobs.find { it.spec.id == id }
        when {
            job == null -> {}
            error == null -> {
                job.state = State.Done
                job.total = job.total ?: job.bytes
                job.bytes = job.total ?: job.bytes
            }
            // Paused, removed or waiting for Wi-Fi, which is already recorded.
            error is Stopped -> {}
            else -> {
                Log.w(TAG, "download failed id=$id: ${error.message}")
                job.state = State.Failed
                job.error = error.message
            }
        }
        changed()
    }

    /** Starts what may run, stops what may not, saves the queue and tells the page. */
    private fun changed() {
        val allowed = !wifiOnly || unmetered()
        if (!allowed) {
            for ((id, stop) in running) {
                stop.set(true)
                jobs.find { it.spec.id == id }?.state = State.Queued
            }
        } else {
            val free = concurrent - running.size
            jobs.filter { it.state == State.Queued && it.spec.id !in running }.take(free.coerceAtLeast(0)).forEach(::start)
        }
        save()
        localFiles = jobs.filter { it.state == State.Done }.flatMap { placed(it) }.map { it.path }.toSet()
        send?.invoke(state())
        onRunning?.invoke(runningNow())
    }

    private fun start(job: Job) {
        job.state = State.Downloading
        val stop = AtomicBoolean(false)
        running[job.spec.id] = stop
        val spec = job.spec
        val folder = File(job.folder)
        workers.execute {
            val error = try {
                work(spec, folder, stop)
                null
            } catch (e: Exception) {
                e
            }
            post { finished(spec.id, error) }
        }
    }

    private fun work(spec: DownloadSpec, folder: File, stop: AtomicBoolean) {
        for (text in spec.texts) {
            val file = place(folder, text.path)
            if (!file.exists()) {
                file.parentFile?.mkdirs()
                file.writeText(text.text)
            }
        }
        // Subtitles and art first, so they are there while the video comes.
        for (file in spec.files.sortedBy { it.kind == Kind.Video }) {
            val target = place(folder, file.path)
            try {
                fetcher.fetch(file.url, target, stop) { bytes, total ->
                    if (file.kind == Kind.Video) post { progress(spec.id, bytes, total) }
                }
            } catch (e: Failed) {
                // Art or a subtitle missing never costs the video.
                if (file.kind == Kind.Video) throw e
                Log.w(TAG, "download ${spec.id}: skipped ${file.path}: ${e.message}")
            }
        }
    }

    private fun progress(id: String, bytes: Long, total: Long?) {
        val job = jobs.find { it.spec.id == id } ?: return
        job.bytes = bytes
        job.total = total ?: job.total
    }

    private fun reportProgress() {
        val now = System.nanoTime()
        val downloading = jobs.filter { it.state == State.Downloading }
        for (job in downloading) {
            val speed = speeds.getOrPut(job.spec.id) { Speed(now, job.bytes, 0) }
            // Measured over a few seconds, so the number holds still enough to read.
            val seconds = (now - speed.since) / 1e9
            if (seconds >= 2) {
                speed.value = ((job.bytes - speed.from) / seconds).toLong().coerceAtLeast(0)
                speed.since = now
                speed.from = job.bytes
            }
            send?.invoke(buildJsonObject {
                put("type", "download-progress")
                put("id", job.spec.id)
                put("bytes", job.bytes)
                put("total", job.total)
                put("speed", speed.value)
            })
        }
        if (downloading.isNotEmpty()) onRunning?.invoke(runningNow())
    }

    private fun runningNow() = jobs.filter { it.state == State.Downloading }.map { Running(it.spec.title, it.bytes, it.total) }

    private fun state() = buildJsonObject {
        put("type", "download-state")
        put("folder", folder.path)
        putJsonArray("jobs") {
            for (job in jobs) addJsonObject {
                put("id", job.spec.id)
                put("state", json.encodeToJsonElement(State.serializer(), job.state))
                put("bytes", job.bytes)
                put("total", job.total)
                put("error", job.error)
                if (job.state == State.Done) {
                    val placed = placed(job)
                    put("video", placed.firstOrNull { it.kind == Kind.Video }?.file?.path)
                    putJsonArray("subtitles") {
                        placed.filter { it.kind == Kind.Subtitle }.forEach { add(it.file.path) }
                    }
                }
            }
        }
    }

    private class Placed(val kind: Kind, val file: File) {
        val path: String get() = file.path
    }

    private fun placed(job: Job): List<Placed> = job.spec.files
        .filter { it.kind != Kind.Image }
        .mapNotNull { file -> runCatching { Placed(file.kind, place(File(job.folder), file.path)) }.getOrNull() }

    private fun save() {
        val saved = Saved(concurrent, wifiOnly, jobs)
        val temporary = File(stateFile.path + ".tmp")
        runCatching {
            temporary.writeText(json.encodeToString(Saved.serializer(), saved))
            if (!temporary.renameTo(stateFile)) Log.w(TAG, "could not save the queue")
        }
    }

    /** Leaves files another download still uses, such as a show's poster. */
    private fun deleteFiles(job: Job) {
        val others = jobs.flatMap { other -> pathsOf(other) }.toSet()
        for (file in pathsOf(job)) {
            if (file in others) continue
            file.delete()
            partOf(file).delete()
            // Empty folders up to the downloads folder go too.
            var dir = file.parentFile
            while (dir != null && dir.path != job.folder && dir.delete()) dir = dir.parentFile
        }
    }

    private fun pathsOf(job: Job): List<File> =
        (job.spec.files.map { it.path } + job.spec.texts.map { it.path })
            .mapNotNull { runCatching { place(File(job.folder), it) }.getOrNull() }

    private fun check(spec: DownloadSpec) {
        require(spec.id.isNotEmpty() && spec.id.length <= 64 && spec.id.all { it.isLetterOrDigit() || it in "-_" }) { "bad id" }
        for (file in spec.files) {
            require(file.url.startsWith("http://") || file.url.startsWith("https://")) { "only http(s) addresses" }
            place(folder, file.path)
        }
        for (text in spec.texts) place(folder, text.path)
    }

    private class Speed(var since: Long, var from: Long, var value: Long)

    private companion object {
        const val TAG = "downloads"
        const val PROGRESS_MS = 500L
        const val MAX_CONCURRENT = 4
    }
}
