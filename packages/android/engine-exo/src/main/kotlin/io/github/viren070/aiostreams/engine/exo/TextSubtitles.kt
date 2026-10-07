package io.github.viren070.aiostreams.engine.exo

import android.graphics.Color
import android.graphics.Typeface
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView

/** mpv's `sub-*` options, which the page sets for every subtitle. */
@OptIn(UnstableApi::class)
internal class SubtitleStyle {
    var visible = true
    var scale = 1.0
    /** Percent of the screen from the top where unplaced lines sit at the bottom. */
    var position = 100.0
    var forceMargins = false
    private var color = Color.WHITE
    private var outlineColor = Color.BLACK
    private var outlineSize = 1.65
    private var backColor = Color.TRANSPARENT
    private var box = false
    private var bold = false
    private var force = false

    /** False for a property that isn't a subtitle style. */
    fun set(name: String, value: String): Boolean {
        when (name) {
            "sub-visibility" -> visible = value == "yes"
            "sub-scale" -> scale = value.toDoubleOrNull() ?: 1.0
            "sub-pos" -> position = value.toDoubleOrNull() ?: 100.0
            "sub-ass-force-margins" -> forceMargins = value == "yes"
            "sub-color" -> color = colorOf(value) ?: color
            "sub-outline-color" -> outlineColor = colorOf(value) ?: outlineColor
            "sub-outline-size" -> outlineSize = value.toDoubleOrNull() ?: outlineSize
            "sub-back-color" -> backColor = colorOf(value) ?: backColor
            "sub-border-style" -> box = value == "background-box"
            "sub-bold" -> bold = value == "yes"
            "sub-ass-override" -> force = value == "force"
            else -> return false
        }
        return true
    }

    fun apply(view: SubtitleView) {
        val edge = if (!box && outlineSize > 0) CaptionStyleCompat.EDGE_TYPE_OUTLINE else CaptionStyleCompat.EDGE_TYPE_NONE
        view.setStyle(
            CaptionStyleCompat(
                color,
                if (box) backColor else Color.TRANSPARENT,
                Color.TRANSPARENT,
                edge,
                outlineColor,
                if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT,
            ),
        )
        view.setApplyEmbeddedStyles(!force)
        view.setApplyEmbeddedFontSizes(!force)
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale.toFloat())
        view.setBottomPaddingFraction(SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION + (100 - position.toFloat()) / 100)
    }

    private companion object {
        /** mpv writes `#AARRGGBB`, as Android reads it. */
        fun colorOf(value: String) = runCatching { Color.parseColor(value) }.getOrNull()
    }
}

/** A subtitle file the page added, which the engine draws itself rather than reloading the video. */
@OptIn(UnstableApi::class)
internal class ExternalSubtitle(
    val id: Int,
    val url: String,
    val title: String?,
    val lang: String?,
    val codec: String,
    /** An ASS script, which libass draws. */
    val script: ByteArray?,
    /** Anything else, which the subtitle view draws. */
    private val cues: List<CuesWithTiming>,
) {
    /** What libass knows the script as. */
    val key = "+$id"

    /** The lines showing at `timeUs`. */
    fun cuesAt(timeUs: Long): List<Cue> =
        cues.filter { timeUs >= it.startTimeUs && timeUs < it.endTimeUs }.flatMap { it.cues }

    companion object {
        fun parse(id: Int, url: String, title: String?, lang: String?, bytes: ByteArray): ExternalSubtitle {
            val text = String(bytes, Charsets.UTF_8).trimStart('﻿', ' ', '\r', '\n')
            if (text.startsWith("[Script Info]", ignoreCase = true)) {
                return ExternalSubtitle(id, url, title, lang, "ass", bytes, emptyList())
            }
            val mime = if (text.startsWith("WEBVTT")) MimeTypes.TEXT_VTT else MimeTypes.APPLICATION_SUBRIP
            val parser = DefaultSubtitleParserFactory().create(Format.Builder().setSampleMimeType(mime).build())
            val cues = mutableListOf<CuesWithTiming>()
            parser.parse(bytes, SubtitleParser.OutputOptions.allCues()) { cues += it }
            parser.reset()
            val codec = if (mime == MimeTypes.TEXT_VTT) "webvtt" else "subrip"
            return ExternalSubtitle(id, url, title, lang, codec, null, cues)
        }
    }
}
