package io.github.viren070.aiostreams.exoplayer.extractor

/** Matroska's element ids, as its EBML writes them with the length marker. */
internal object MatroskaIds {
    const val EBML = 0x1A45DFA3
    const val SEGMENT = 0x18538067
    const val SEEK_HEAD = 0x114D9B74
    const val SEEK = 0x4DBB
    const val SEEK_ID = 0x53AB
    const val SEEK_POSITION = 0x53AC
    const val TIMECODE_SCALE = 0x2AD7B1
    const val TRACK_ENTRY = 0xAE
    const val TRACK_NUMBER = 0xD7
    const val DEFAULT_DURATION = 0x23E383
    const val CONTENT_COMPRESSION = 0x5034
    const val CONTENT_COMPRESSION_ALGORITHM = 0x4254
    const val CONTENT_COMPRESSION_SETTINGS = 0x4255
    const val CLUSTER = 0x1F43B675
    const val SIMPLE_BLOCK = 0xA3
    const val BLOCK = 0xA1
    const val CUES = 0x1C53BB6B
    const val CUE_POINT = 0xBB
    const val CUE_TIME = 0xB3
    const val CUE_TRACK_POSITIONS = 0xB7
    const val CUE_TRACK = 0xF7
    const val CUE_CLUSTER_POSITION = 0xF1
    const val CUE_DURATION = 0xB2
    const val ATTACHMENTS = 0x1941A469
    const val ATTACHED_FILE = 0x61A7
    const val FILE_NAME = 0x466E
    const val FILE_MIME_TYPE = 0x4660
    const val FILE_DATA = 0x465C
}

/** The bytes of the EBML number starting with [first]: 1 to 8, or 9 for none. */
internal fun vintLength(first: Byte) = Integer.numberOfLeadingZeros(first.toInt() and 0xFF) - 23
