package io.github.viren070.aiostreams.exoplayer

import android.graphics.Bitmap
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.text.Cue
import androidx.media3.common.util.Consumer
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.SubtitleParser
import java.io.ByteArrayOutputStream
import java.util.zip.Inflater

/**
 * Blu-ray picture subtitles, with every object a display set composes, such as a line and a sign at once.
 * Palettes and objects carry over to later display sets of the same epoch.
 */
@OptIn(UnstableApi::class)
internal class Pgs : SubtitleParser {
    private class Placed(val objectId: Int, val x: Int, val y: Int, val crop: IntArray?)

    private val palettes = HashMap<Int, IntArray>()
    private val objects = HashMap<Int, Picture>()
    private var pending: Picture? = null
    private var width = 0
    private var height = 0
    private var paletteId = 0
    private var placed = emptyList<Placed>()
    private val inflated = ParsableByteArray()
    private val inflater = Inflater()

    private class Picture(val width: Int, val height: Int, val data: ByteArrayOutputStream)

    override fun getCueReplacementBehavior() = Format.CUE_REPLACEMENT_BEHAVIOR_REPLACE

    override fun parse(
        data: ByteArray,
        offset: Int,
        length: Int,
        outputOptions: SubtitleParser.OutputOptions,
        output: Consumer<CuesWithTiming>,
    ) {
        var buffer = ParsableByteArray(data, offset + length).apply { position = offset }
        // Matroska may carry the display set compressed.
        if (Util.maybeInflate(buffer, inflated, inflater)) buffer = ParsableByteArray(inflated.data, inflated.limit())
        val cues = mutableListOf<Cue>()
        while (buffer.bytesLeft() >= 3) {
            val type = buffer.readUnsignedByte()
            val size = buffer.readUnsignedShort()
            val next = buffer.position + size
            if (next > buffer.limit()) break
            when (type) {
                PALETTE -> palette(buffer, size)
                OBJECT -> picture(buffer, size)
                COMPOSITION -> composition(buffer, size)
                END -> cues += build()
            }
            buffer.position = next
        }
        output.accept(CuesWithTiming(cues, C.TIME_UNSET, C.TIME_UNSET))
    }

    private fun composition(buffer: ParsableByteArray, size: Int) {
        if (size < 11) return
        width = buffer.readUnsignedShort()
        height = buffer.readUnsignedShort()
        buffer.skipBytes(3) // frame rate, composition number
        val state = buffer.readUnsignedByte()
        if (state and EPOCH_START != 0) {
            palettes.clear()
            objects.clear()
        }
        buffer.skipBytes(1) // palette update
        paletteId = buffer.readUnsignedByte()
        val count = buffer.readUnsignedByte()
        placed = List(count) {
            if (buffer.bytesLeft() < 8) return
            val objectId = buffer.readUnsignedShort()
            buffer.skipBytes(1) // window
            val cropped = buffer.readUnsignedByte() and 0x40 != 0
            val x = buffer.readUnsignedShort()
            val y = buffer.readUnsignedShort()
            val crop = if (cropped && buffer.bytesLeft() >= 8) IntArray(4) { buffer.readUnsignedShort() } else null
            Placed(objectId, x, y, crop)
        }
    }

    private fun palette(buffer: ParsableByteArray, size: Int) {
        if (size % 5 != 2) return
        val id = buffer.readUnsignedByte()
        buffer.skipBytes(1) // version
        val colors = palettes.getOrPut(id) { IntArray(256) }
        repeat(size / 5) {
            val index = buffer.readUnsignedByte()
            val y = buffer.readUnsignedByte()
            val cr = buffer.readUnsignedByte()
            val cb = buffer.readUnsignedByte()
            val a = buffer.readUnsignedByte()
            val r = (y + 1.40200 * (cr - 128)).toInt().coerceIn(0, 255)
            val g = (y - 0.34414 * (cb - 128) - 0.71414 * (cr - 128)).toInt().coerceIn(0, 255)
            val b = (y + 1.77200 * (cb - 128)).toInt().coerceIn(0, 255)
            colors[index] = (a shl 24) or (r shl 16) or (g shl 8) or b
        }
    }

    private fun picture(buffer: ParsableByteArray, size: Int) {
        if (size < 4) return
        val id = buffer.readUnsignedShort()
        buffer.skipBytes(1) // version
        val sequence = buffer.readUnsignedByte()
        var left = size - 4
        if (sequence and FIRST != 0) {
            if (left < 7) return
            val total = buffer.readUnsignedInt24()
            val picture = Picture(buffer.readUnsignedShort(), buffer.readUnsignedShort(), ByteArrayOutputStream(maxOf(total - 4, 0)))
            left -= 7
            pending = picture
            objects[id] = picture
        }
        val picture = pending ?: return
        picture.data.write(buffer.data, buffer.position, left)
        if (sequence and LAST != 0) pending = null
    }

    private fun build(): List<Cue> {
        val colors = palettes[paletteId] ?: return emptyList()
        if (width == 0 || height == 0) return emptyList()
        return placed.mapNotNull { at ->
            val picture = objects[at.objectId] ?: return@mapNotNull null
            var bitmap = decode(picture, colors) ?: return@mapNotNull null
            at.crop?.let { (cropX, cropY, cropWidth, cropHeight) ->
                val w = minOf(cropWidth, bitmap.width - cropX)
                val h = minOf(cropHeight, bitmap.height - cropY)
                if (cropX < 0 || cropY < 0 || w <= 0 || h <= 0) return@mapNotNull null
                bitmap = Bitmap.createBitmap(bitmap, cropX, cropY, w, h)
            }
            Cue.Builder()
                .setBitmap(bitmap)
                .setPosition(at.x.toFloat() / width)
                .setPositionAnchor(Cue.ANCHOR_TYPE_START)
                .setLine(at.y.toFloat() / height, Cue.LINE_TYPE_FRACTION)
                .setLineAnchor(Cue.ANCHOR_TYPE_START)
                .setSize(bitmap.width.toFloat() / width)
                .setBitmapHeight(bitmap.height.toFloat() / height)
                .build()
        }
    }

    private fun decode(picture: Picture, colors: IntArray): Bitmap? {
        if (picture.width == 0 || picture.height == 0) return null
        val rle = picture.data.toByteArray()
        val pixels = IntArray(picture.width * picture.height)
        var at = 0
        var i = 0
        fun next() = if (i < rle.size) rle[i++].toInt() and 0xFF else -1
        while (at < pixels.size) {
            val index = next()
            if (index < 0) break
            if (index != 0) {
                pixels[at++] = colors[index]
                continue
            }
            val bits = next()
            if (bits <= 0) continue
            val run = if (bits and 0x40 == 0) bits and 0x3F else (bits and 0x3F shl 8) or maxOf(next(), 0)
            val color = if (bits and 0x80 == 0) colors[0] else colors[maxOf(next(), 0)]
            pixels.fill(color, at, minOf(at + run, pixels.size))
            at += run
        }
        return Bitmap.createBitmap(pixels, picture.width, picture.height, Bitmap.Config.ARGB_8888)
    }

    private companion object {
        const val PALETTE = 0x14
        const val OBJECT = 0x15
        const val COMPOSITION = 0x16
        const val END = 0x80

        const val EPOCH_START = 0x80
        const val FIRST = 0x80
        const val LAST = 0x40
    }
}
