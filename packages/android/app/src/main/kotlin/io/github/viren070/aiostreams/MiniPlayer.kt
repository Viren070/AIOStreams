package io.github.viren070.aiostreams

import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.math.hypot

/**
 * The video small under the page, where the page's mini player leaves room for
 * it: the stage shrinks to the frame and a rounded hole through the page shows
 * it. A drag of a draggable frame is taken here, as the page would trail it, and
 * the page hears where it let go.
 */
class MiniPlayer(
    private val stage: FrameLayout,
    private val web: View,
    private val send: (JsonObject) -> Unit,
    private val showSubtitles: (Boolean) -> Unit,
) {
    private class Frame(
        val x: Float,
        val y: Float,
        val width: Int,
        val height: Int,
        val draggable: Boolean,
        val hidden: Boolean,
        val subtitles: Boolean,
        val radius: Float,
        val bottomRadius: Float,
    )

    private var frame: Frame? = null
    private var pictureInPicture = false
    private var pageHidden = false
    private val clear = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
    private val outline = Path()
    private val radii = FloatArray(8)

    /** Over the page, clearing it where the stage is: the page can be cut round, a video surface can't. */
    private val hole = object : View(web.context) {
        override fun onDraw(canvas: Canvas) {
            val shown = shown() ?: return
            if (shown.hidden) return
            // The page's card fades while it drags, leaving the video's bottom corners bare.
            val bottom = if (dragging) shown.radius else shown.bottomRadius
            radii.fill(shown.radius, 0, 4)
            radii.fill(bottom, 4, 8)
            outline.rewind()
            outline.addRoundRect(stage.x, stage.y, stage.x + shown.width, stage.y + shown.height, radii, Path.Direction.CW)
            canvas.drawPath(outline, clear)
        }
    }
    private var animator: ValueAnimator? = null
    private var overScroll = web.overScrollMode
    private val density get() = web.resources.displayMetrics.density
    private val slop = ViewConfiguration.get(web.context).scaledTouchSlop

    private var down: Pair<Float, Float>? = null
    private var start = 0f to 0f
    private var dragging = false

    init {
        hole.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        (web.parent as ViewGroup).addView(hole, MATCH_PARENT, MATCH_PARENT)
    }

    /** From the page's `player-frame`, in its pixels; none fills the window again. */
    fun place(message: JsonObject) {
        val json = message["frame"]?.takeIf { it is JsonObject }?.jsonObject
        val number = { key: String -> json?.get(key)?.jsonPrimitive?.floatOrNull ?: 0f }
        val flag = { key: String -> json?.get(key)?.jsonPrimitive?.booleanOrNull == true }
        val next = json?.let {
            Frame(
                x = number("x") * density,
                y = number("y") * density,
                width = (number("width") * density).toInt(),
                height = (number("height") * density).toInt(),
                draggable = flag("draggable"),
                hidden = flag("hidden"),
                subtitles = flag("subtitles"),
                radius = number("radius") * density,
                bottomRadius = number("bottomRadius") * density,
            )
        }
        frame = next
        if (!dragging) refresh(animate = next != null && flag("animate"))
    }

    fun pictureInPicture(on: Boolean) {
        if (on == pictureInPicture) return
        pictureInPicture = on
        // The page is only see-through on the player's own page, so it would cover the video.
        if (on && frame != null) {
            pageHidden = true
            web.visibility = View.INVISIBLE
        } else if (!on && pageHidden) {
            pageHidden = false
            web.visibility = View.VISIBLE
        }
        refresh(animate = false)
    }

    private fun shown() = frame.takeUnless { pictureInPicture }

    private fun refresh(animate: Boolean) {
        val shown = shown()
        val params = stage.layoutParams as FrameLayout.LayoutParams
        val width = shown?.width ?: MATCH_PARENT
        val height = shown?.height ?: MATCH_PARENT
        if (params.width != width || params.height != height || params.gravity != Gravity.TOP or Gravity.LEFT) {
            params.width = width
            params.height = height
            params.gravity = Gravity.TOP or Gravity.LEFT
            stage.layoutParams = params
        }
        animator?.cancel()
        val x = shown?.x ?: 0f
        val y = shown?.y ?: 0f
        if (animate && shown != null) moveTo(x, y) else moveBy(x, y)
        showSubtitles(shown?.subtitles != false)
        if (shown != null) {
            if (web.overScrollMode != View.OVER_SCROLL_NEVER) overScroll = web.overScrollMode
            // The page stretches as a whole, which the video under it can't follow.
            web.overScrollMode = View.OVER_SCROLL_NEVER
        } else {
            web.overScrollMode = overScroll
        }
    }

    private fun moveTo(x: Float, y: Float) {
        val fromX = stage.translationX
        val fromY = stage.translationY
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = MOVE_MS
            interpolator = PathInterpolator(0.2f, 0.8f, 0.2f, 1f)
            addUpdateListener {
                val t = it.animatedValue as Float
                moveBy(fromX + (x - fromX) * t, fromY + (y - fromY) * t)
            }
            start()
        }
    }

    private fun moveBy(x: Float, y: Float) {
        stage.translationX = x
        stage.translationY = y
        hole.invalidate()
    }

    /** Takes a press on a draggable frame's video, which the page then doesn't get. */
    fun onTouch(event: MotionEvent): Boolean {
        val shown = shown()
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            down = null
            dragging = false
            if (shown == null || !shown.draggable || shown.hidden) return false
            val inside = event.x >= stage.translationX && event.x < stage.translationX + shown.width &&
                event.y >= stage.translationY && event.y < stage.translationY + shown.height
            if (!inside) return false
            animator?.cancel()
            down = event.x to event.y
            start = stage.translationX to stage.translationY
            return true
        }
        val (downX, downY) = down ?: return false
        val dx = event.x - downX
        val dy = event.y - downY
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && hypot(dx, dy) > slop) {
                    dragging = true
                    send(event("grabbed"))
                }
                if (dragging && shown != null) {
                    moveBy(
                        (start.first + dx).coerceIn(0f, (web.width - shown.width).coerceAtLeast(0).toFloat()),
                        (start.second + dy).coerceIn(0f, (web.height - shown.height).coerceAtLeast(0).toFloat()),
                    )
                    send(at("moving"))
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                down = null
                if (dragging) {
                    dragging = false
                    send(at("moved"))
                } else if (event.actionMasked == MotionEvent.ACTION_UP) {
                    send(event("tap"))
                }
            }
        }
        return true
    }

    private fun at(name: String) = event(name) {
        put("x", stage.translationX / density)
        put("y", stage.translationY / density)
    }

    private fun event(name: String, more: JsonObjectBuilder.() -> Unit = {}) = buildJsonObject {
        put("type", "player-frame")
        put("event", name)
        more()
    }

    private companion object {
        /** As the page's card moves. */
        const val MOVE_MS = 220L
    }
}
