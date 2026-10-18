package io.github.viren070.aiostreams.exoplayer

/**
 * Where a file keeps the index its extractor reads before it plays, when that
 * comes after the start: a Matroska file's Cues, an MP4's moov after its mdat.
 */
internal object FileIndex {
    /** The bytes to fetch for it, from the file's first bytes; null for an index at the start or none found. */
    fun locate(head: ByteArray, length: Long): LongRange? {
        val (start, next) = runCatching { matroskaCues(head) ?: mp4Moov(head) }.getOrNull() ?: return null
        if (start < head.size || (length > 0 && start >= length)) return null
        return start until listOfNotNull(next, length.takeIf { it > 0 }, start + MAX_BYTES).min()
    }

    /** Where the Cues start, and where the next element the SeekHead lists does. */
    private fun matroskaCues(head: ByteArray): Pair<Long, Long?>? {
        val reader = Ebml(head)
        if (reader.id() != EBML) return null
        reader.skip(reader.size())
        if (reader.id() != SEGMENT) return null
        reader.size()
        val segment = reader.at
        while (reader.at < head.size) {
            val id = reader.id()
            val size = reader.size()
            if (id != SEEK_HEAD) {
                if (id == CLUSTER) return null
                reader.skip(size)
                continue
            }
            val end = reader.at + size
            var cues: Long? = null
            val positions = mutableListOf<Long>()
            while (reader.at < end) {
                val entry = reader.id()
                val entryEnd = reader.at + reader.size()
                var target = 0L
                var position = -1L
                while (reader.at < entryEnd) {
                    val field = reader.id()
                    val value = reader.uint(reader.size().toInt())
                    if (field == SEEK_ID) target = value
                    if (field == SEEK_POSITION) position = value
                }
                if (entry != SEEK || position < 0) continue
                positions += segment + position
                if (target == CUES) cues = segment + position
            }
            return cues?.let { start -> start to positions.filter { it > start }.minOrNull() }
        }
        return null
    }

    private fun mp4Moov(head: ByteArray): Pair<Long, Long?>? {
        var at = 0L
        while (at + 8 <= head.size) {
            var size = be(head, at.toInt(), 4)
            val type = String(head, at.toInt() + 4, 4, Charsets.US_ASCII)
            if (size == 1L && at + 16 <= head.size) size = be(head, at.toInt() + 8, 8)
            if (at == 0L && type != "ftyp") return null
            if (type == "moov") return null
            if (size < 8) return null
            if (type == "mdat") return at + size to null
            at += size
        }
        return null
    }

    private fun be(bytes: ByteArray, from: Int, count: Int): Long {
        var value = 0L
        for (i in from until from + count) value = (value shl 8) or (bytes[i].toLong() and 0xFF)
        return value
    }

    private class Ebml(private val bytes: ByteArray) {
        var at = 0L
            private set

        fun id(): Long = vint(keepMarker = true)

        fun size(): Long = vint(keepMarker = false)

        fun skip(count: Long) {
            at += count
        }

        fun uint(count: Int): Long {
            val value = be(bytes, at.toInt(), count)
            at += count
            return value
        }

        private fun vint(keepMarker: Boolean): Long {
            val first = bytes[at.toInt()].toInt() and 0xFF
            val length = Integer.numberOfLeadingZeros(first) - 23
            require(length in 1..8) { "not a Matroska number" }
            var value = (if (keepMarker) first else first and (0xFF shr length)).toLong()
            for (i in 1 until length) value = (value shl 8) or (bytes[at.toInt() + i].toLong() and 0xFF)
            at += length
            return value
        }
    }

    /** Past a long film's moov, whose size the start doesn't give; the extractor reads on from the link if there's more. */
    private const val MAX_BYTES = 8L shl 20

    private const val EBML = 0x1A45DFA3L
    private const val SEGMENT = 0x18538067L
    private const val SEEK_HEAD = 0x114D9B74L
    private const val SEEK = 0x4DBBL
    private const val SEEK_ID = 0x53ABL
    private const val SEEK_POSITION = 0x53ACL
    private const val CUES = 0x1C53BB6BL
    private const val CLUSTER = 0x1F43B675L
}
