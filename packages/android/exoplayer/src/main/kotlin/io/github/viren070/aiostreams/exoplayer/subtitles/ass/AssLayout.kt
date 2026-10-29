package io.github.viren070.aiostreams.exoplayer.subtitles.ass

import android.graphics.Rect
import io.github.viren070.aiostreams.exoplayer.subtitles.SubtitleStyle
import kotlin.math.roundToInt

/** The stage's size, where the video sits on it, and the video's own size. */
internal data class StageLayout(
    val width: Int = 0,
    val height: Int = 0,
    val video: Rect = Rect(),
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
)

/** mpv's `sub-ass-override`, and the look it forces on dialogue. Colours are ASS's RGBA. */
internal data class AssStyle(
    val override: Int,
    val color: Int,
    val outlineColor: Int,
    val backColor: Int,
    val outlineSize: Double,
    val borderStyle: Int,
    val bold: Boolean,
    val shadowSize: Double,
    /** Drawn in place of the bundled font where the style is forced; null keeps it. */
    val fontFile: String?,
) {
    companion object {
        const val NONE = 0
        const val SCALE = 1
        const val FORCE = 2
    }
}

/**
 * mpv's configure_ass(): its own options reach ASS only as far as the override
 * allows, here on a [width] by [height] frame over the [stage]. Text made into
 * ASS is [converted], and takes the user's look whole.
 */
internal class AssLayout(stage: StageLayout, style: SubtitleStyle, width: Int, height: Int, converted: Boolean) {
    private val forced = style.override == AssStyle.FORCE || converted
    private val overridden = forced || style.override != AssStyle.NONE

    val assStyle = style.assStyle().let { if (forced) it.copy(override = AssStyle.FORCE) else it.copy(fontFile = null) }
    val useMargins = forced || style.forceMargins
    val linePosition = if (overridden) 100 - style.position else 0.0
    val fontScale: Float

    // The margins around the video, in the frame's pixels.
    val top: Int
    val bottom: Int
    val left: Int
    val right: Int

    init {
        val sx = width.toDouble() / stage.width
        val sy = height.toDouble() / stage.height
        var scale = if (overridden) style.scale else 1.0
        if (forced) {
            // Sized to the screen rather than the video, as mpv's sub-scale-with-window does.
            val videoWidth = stage.video.width() * sx
            val videoHeight = stage.video.height() * sy
            if (videoWidth >= 1) scale *= height / minOf(height.toDouble(), width / videoWidth * videoHeight)
        }
        fontScale = scale.toFloat()
        top = (stage.video.top * sy).roundToInt()
        bottom = ((stage.height - stage.video.bottom) * sy).roundToInt()
        left = (stage.video.left * sx).roundToInt()
        right = ((stage.width - stage.video.right) * sx).roundToInt()
    }
}
