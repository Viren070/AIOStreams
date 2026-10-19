package io.github.viren070.aiostreams.natives

/** Seek-bar thumbnails of a file, decoded from its keyframes outside the players. */
object Thumbnails {
    init {
        System.loadLibrary("aiostreams_native")
    }

    fun interface Listener {
        /** A JPEG of the keyframe at `positionMs`, or with `error`, none for the file. Runs on a background thread. */
        fun onThumbnail(positionMs: Long, jpeg: ByteArray?, error: String?)
    }

    /**
     * A handle for [want] and [close]; the file opens on the first [want]. `headers` alternates names
     * and values; `caPem` is the device's trusted roots as PEM.
     */
    @JvmStatic
    external fun open(url: String, headers: Array<String>, caPem: ByteArray?, listener: Listener): Long

    /**
     * Asks for the keyframe at or before `positionMs`; the newest asked wins. `showingMs` is the
     * keyframe of the picture on screen, which isn't sent again, or -1.
     */
    @JvmStatic
    external fun want(handle: Long, positionMs: Long, showingMs: Long)

    /** Reads the file's index ahead of the first [want], which then waits only for its keyframe. */
    @JvmStatic
    external fun prepare(handle: Long)

    @JvmStatic
    external fun close(handle: Long)
}
