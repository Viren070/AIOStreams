package io.github.viren070.aiostreams.exoplayer

import android.content.Context
import android.graphics.Rect
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.SubtitleView
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The video fitted to the screen as mpv fits it, with the subtitles over the whole screen. */
@OptIn(UnstableApi::class)
internal class Stage(context: Context, private val onLayout: (width: Int, height: Int, video: Rect) -> Unit) :
    FrameLayout(context) {
    val video = SurfaceView(context)
    val subtitles = SubtitleView(context)
    private val rect = Rect()

    var videoSize = VideoSize.UNKNOWN
        set(value) {
            field = value
            requestLayout()
        }

    /** mpv's `keepaspect`: off stretches the picture to the screen. */
    var keepAspect = true
        set(value) {
            field = value
            requestLayout()
        }

    /** mpv's `panscan`: from fitting the picture inside the screen (0) to filling it (1). */
    var panscan = 0.0
        set(value) {
            field = value
            requestLayout()
        }

    init {
        addView(video)
        addView(subtitles)
    }

    /** A layer between the video and the subtitle view. */
    fun addLayer(view: View) = addView(view, indexOfChild(subtitles))

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val width = right - left
        val height = bottom - top
        fit(width, height)
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            if (child == video) child.layout(rect.left, rect.top, rect.right, rect.bottom)
            else child.layout(0, 0, width, height)
        }
        onLayout(width, height, Rect(rect))
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(width, height)
        fit(width, height)
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            val box = if (child == video) rect else Rect(0, 0, width, height)
            child.measure(
                MeasureSpec.makeMeasureSpec(box.width(), MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(box.height(), MeasureSpec.EXACTLY),
            )
        }
    }

    private fun fit(width: Int, height: Int) {
        val size = videoSize
        if (size.width <= 0 || size.height <= 0 || !keepAspect) return rect.set(0, 0, width, height)
        val aspect = size.width * size.pixelWidthHeightRatio / size.height
        val inside = min(width / aspect, height.toFloat())
        val filled = max(width / aspect, height.toFloat())
        val shownHeight = inside + (filled - inside) * panscan.toFloat()
        val shownWidth = shownHeight * aspect
        val x = ((width - shownWidth) / 2).roundToInt()
        val y = ((height - shownHeight) / 2).roundToInt()
        rect.set(x, y, x + shownWidth.roundToInt(), y + shownHeight.roundToInt())
    }
}
