package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import android.view.Surface

/** Each call takes [create]'s handle. */
internal object AssNative {
    init {
        System.loadLibrary("aiostreams_ass")
    }

    @JvmStatic
    external fun create(font: String): Long

    @JvmStatic
    external fun addFont(handle: Long, name: String, data: ByteArray)

    @JvmStatic
    external fun clearFonts(handle: Long)

    @JvmStatic
    external fun reloadFonts(handle: Long)

    @JvmStatic
    external fun newTrack(handle: Long, header: ByteArray): Long

    @JvmStatic
    external fun readScript(handle: Long, script: ByteArray): Long

    @JvmStatic
    external fun addLine(track: Long, line: ByteArray, startMs: Long, durationMs: Long)

    @JvmStatic
    external fun freeTrack(track: Long)

    @JvmStatic
    external fun flushTrack(track: Long)

    @JvmStatic
    external fun setCacheLimit(handle: Long, mb: Int)

    @JvmStatic
    external fun setWindow(handle: Long, surface: Surface?, width: Int, height: Int)

    @JvmStatic
    external fun setFrameSize(handle: Long, width: Int, height: Int)

    @JvmStatic
    external fun setLayout(
        handle: Long, videoWidth: Int, videoHeight: Int, top: Int, bottom: Int, left: Int, right: Int,
        useMargins: Boolean, fontScale: Float, linePosition: Double,
    )

    @JvmStatic
    external fun setStyle(
        handle: Long, override: Int, color: Int, outlineColor: Int, backColor: Int,
        outlineSize: Double, borderStyle: Int, bold: Boolean, shadowSize: Double, fontFile: String?,
    )

    @JvmStatic
    external fun queue(handle: Long, track: Long, timeMs: Long)

    @JvmStatic
    external fun room(handle: Long, moments: Int, bytes: Long): Boolean

    @JvmStatic
    external fun dropFrom(handle: Long, timeMs: Long)

    @JvmStatic
    external fun take(handle: Long, timeMs: Long, waitMs: Int): Int

    @JvmStatic
    external fun draw(handle: Long): Boolean

    @JvmStatic
    external fun stamped(handle: Long): Boolean

    @JvmStatic
    external fun post(handle: Long, atNanos: Long)

    @JvmStatic
    external fun release(handle: Long)
}
