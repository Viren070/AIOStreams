package io.github.viren070.aiostreams.exoplayer.subtitles

import android.graphics.Color
import android.graphics.Typeface
import androidx.annotation.OptIn
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import io.github.viren070.aiostreams.exoplayer.subtitles.ass.AssStyle
import io.github.viren070.aiostreams.playback.SubtitleLook

/** mpv's `sub-*` options, which the page sets for every subtitle. */
@OptIn(UnstableApi::class)
internal data class SubtitleStyle(private val look: SubtitleLook = DEFAULT, val forceMargins: Boolean = false) {
    val scale get() = look.scale

    /** Percent of the screen from the top where unplaced lines sit at the bottom. */
    val position get() = look.position

    /** The share of the height the subtitles are raised by. */
    val lift get() = ((100 - position) / 100).toFloat()

    val override get() = if (look.forceStyle) AssStyle.FORCE else AssStyle.SCALE

    private val color get() = colorOf(look.color, Color.WHITE)
    private val outlineColor get() = colorOf(look.outlineColor, Color.BLACK)
    private val backColor get() = colorOf(look.backColor, Color.TRANSPARENT)

    /** The same but for where unplaced lines sit. */
    fun looksLike(other: SubtitleStyle) = copy(look = look.copy(position = other.position)) == other

    fun applyTo(view: SubtitleView) {
        // The view draws one edge, so a shadow takes the outline's place.
        val edge = when {
            look.box -> CaptionStyleCompat.EDGE_TYPE_NONE
            look.shadowSize > 0 -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW
            look.outlineSize > 0 -> CaptionStyleCompat.EDGE_TYPE_OUTLINE
            else -> CaptionStyleCompat.EDGE_TYPE_NONE
        }
        val family = look.font?.let { Typeface.create(it.id, Typeface.NORMAL) } ?: Typeface.DEFAULT
        view.setStyle(
            CaptionStyleCompat(
                color,
                if (look.box) backColor else Color.TRANSPARENT,
                Color.TRANSPARENT,
                edge,
                outlineColor,
                Typeface.create(family, if (look.bold) Typeface.BOLD else Typeface.NORMAL),
            ),
        )
        view.setApplyEmbeddedStyles(!look.forceStyle)
        view.setApplyEmbeddedFontSizes(!look.forceStyle)
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale.toFloat())
        place(view)
    }

    fun place(view: SubtitleView) {
        view.setBottomPaddingFraction(BOTTOM_PADDING + lift)
    }

    /**
     * A cue as the subtitle view draws it: WebVTT's automatic line arrives as the last line, which the view's
     * bottom padding never moves, and pictures in the lower half rise by [lift], no higher than the top.
     */
    fun placed(cue: Cue): Cue = when {
        cue.verticalType == Cue.TYPE_UNSET && cue.lineType == Cue.LINE_TYPE_NUMBER && cue.line == -1f ->
            cue.buildUpon().setLine(Cue.DIMEN_UNSET, Cue.TYPE_UNSET).build()
        cue.bitmap != null && lift > 0 && cue.lineType == Cue.LINE_TYPE_FRACTION && cue.line >= 0.5f ->
            cue.buildUpon().setLine(maxOf(0f, cue.line - lift), Cue.LINE_TYPE_FRACTION).build()
        else -> cue
    }

    fun assStyle() = AssStyle(
        override = override,
        color = assColor(color),
        outlineColor = assColor(outlineColor),
        // Outside a box, ASS draws the shadow in its back colour.
        backColor = assColor(if (look.box) backColor else outlineColor),
        outlineSize = look.outlineSize,
        // mpv's numbers for outline-and-shadow and background-box.
        borderStyle = if (look.box) 4 else 1,
        bold = look.bold,
        shadowSize = look.shadowSize,
        fontFile = look.font?.file?.takeIf { it.canRead() }?.path,
    )

    private companion object {
        /** mpv's `sub-margin-y`, as a share of the screen. */
        const val BOTTOM_PADDING = 0.03f

        val DEFAULT = SubtitleLook(
            scale = 1.0,
            bold = false,
            color = "#FFFFFFFF",
            outlineColor = "#FF000000",
            outlineSize = 1.65,
            shadowSize = 0.0,
            font = null,
            backColor = "#00000000",
            box = false,
            forceStyle = false,
            position = 100.0,
        )

        /** mpv writes `#AARRGGBB`, as Android reads it. */
        fun colorOf(value: String, default: Int) = runCatching { Color.parseColor(value) }.getOrDefault(default)

        /** ASS keeps alpha last, and counts it as transparency. */
        fun assColor(argb: Int) =
            (Color.red(argb) shl 24) or (Color.green(argb) shl 16) or (Color.blue(argb) shl 8) or (255 - Color.alpha(argb))
    }
}
