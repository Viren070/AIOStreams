package io.github.viren070.aiostreams.downloads

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Paused or removed while it ran. */
internal class Stopped : Exception()

internal class Failed(message: String) : Exception(message)

/** Fetches one file into a `.part` beside it, resuming from what is there. */
internal class Fetcher(userAgent: String) {
    private val client = OkHttpClient.Builder()
        // No timeout bounds a stalled read on its own, so each request ends after
        // this and the next one carries on from what was written.
        .callTimeout(90, TimeUnit.SECONDS)
        .connectTimeout(20, TimeUnit.SECONDS)
        .addNetworkInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().header("User-Agent", userAgent).build())
        }
        .build()

    fun fetch(url: String, target: File, stop: AtomicBoolean, report: (Long, Long?) -> Unit) {
        if (target.exists()) return report(target.length(), target.length())
        target.parentFile?.mkdirs()
        val part = partOf(target)
        // Later ranges go to where the first request was sent on to; an address
        // that has since expired is asked for again through `url`.
        var address = url
        var failures = 0
        var total: Long? = null
        while (true) {
            if (stop.get()) throw Stopped()
            var have = if (part.exists()) part.length() else 0
            if (total != null && have >= total) return finish(part, target)
            val request = Request.Builder().url(address)
                .apply { if (have > 0) header("Range", "bytes=$have-") }
                .build()
            val error = try {
                client.newCall(request).execute().use { response ->
                    when {
                        response.code == 416 && have > 0 -> return finish(part, target)
                        response.code in EXPIRED && address != url -> {
                            address = url
                            null
                        }
                        !response.isSuccessful && response.code < 500 && response.code != 429 ->
                            throw Failed("The server answered ${response.code}")
                        !response.isSuccessful -> "The server answered ${response.code}"
                        else -> {
                            if (response.code == 200) have = 0
                            total = totalOf(response, have) ?: total
                            address = response.request.url.toString()
                            val copied = copy(response, part, have, stop) { report(have + it, total) }
                            val complete = total?.let { have + copied.written >= it } ?: copied.whole
                            if (complete) return finish(part, target)
                            if (copied.written > 0) failures = 0
                            if (copied.written > 0) null else "the answer ended early"
                        }
                    }
                }
            } catch (e: IOException) {
                e.message ?: e.javaClass.simpleName
            } ?: continue
            val wait = RETRY_SECONDS.getOrNull(failures++) ?: throw Failed(error)
            val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(wait)
            while (System.nanoTime() < until) {
                if (stop.get()) throw Stopped()
                Thread.sleep(200)
            }
        }
    }

    /** `whole` once the answer ended; a dropped connection leaves the rest to the next range. */
    private class Copied(val written: Long, val whole: Boolean)

    private fun copy(response: Response, part: File, have: Long, stop: AtomicBoolean, report: (Long) -> Unit): Copied {
        var written = 0L
        FileOutputStream(part, have > 0).use { file ->
            val buffer = ByteArray(256 * 1024)
            val body = response.body.byteStream()
            try {
                while (true) {
                    if (stop.get()) throw Stopped()
                    val n = body.read(buffer)
                    if (n < 0) return Copied(written, whole = true)
                    file.write(buffer, 0, n)
                    written += n
                    report(written)
                }
            } catch (_: IOException) {
                return Copied(written, whole = false)
            }
        }
    }

    private fun finish(part: File, target: File) {
        if (!part.renameTo(target)) throw Failed("Could not save ${target.name}")
    }

    private companion object {
        val RETRY_SECONDS = longArrayOf(2, 5, 15, 30, 60)
        val EXPIRED = setOf(401, 403, 404, 410)

        /** `bytes a-b/total`, or the length of a whole answer. */
        fun totalOf(response: Response, offset: Long): Long? {
            response.header("Content-Range")?.let { return it.substringAfterLast('/').toLongOrNull() }
            return response.header("Content-Length")?.toLongOrNull()?.plus(offset)
        }
    }
}
