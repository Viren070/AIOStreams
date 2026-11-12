package io.github.viren070.aiostreams.natives

/** The anime upscaling network, from its crate. */
object Upscaling {
    init {
        System.loadLibrary("aiostreams_native")
    }

    /** The weights, as JSON. */
    @JvmStatic
    external fun network(): String

    @JvmStatic
    external fun mpvShader(): String

    @JvmStatic
    external fun minScale(): Float
}
