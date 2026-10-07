package io.github.viren070.aiostreams.downloads

import java.io.File

private val EXTENSIONS = setOf(
    "mkv", "mp4", "m4v", "avi", "mov", "webm", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg", "ogv",
    "3gp", "srt", "vtt", "ass", "ssa", "sub", "sup", "idx", "ttml", "jpg", "jpeg", "png", "webp",
    "avif", "json",
)

// Names Windows refuses, for files copied off the phone.
private val RESERVED = setOf(
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
)

/** Inside `folder`, a known media, subtitle, image or details file, as the desktop app allows. */
internal fun place(folder: File, relative: String): File {
    val parts = relative.split('/')
    for (part in parts) {
        val stem = part.substringBefore('.').uppercase()
        val bad = part.isEmpty() || part == "." || part == ".." || part.length > 200 ||
            part.endsWith('.') || part.endsWith(' ') ||
            part.any { it.isISOControl() || it in "<>:\"\\|?*" } || stem in RESERVED
        require(!bad) { "$part is not a usable name" }
    }
    require(relative.substringAfterLast('.', "").lowercase() in EXTENSIONS) { "$relative is not a media file" }
    return File(folder, relative)
}

internal fun partOf(file: File) = File(file.parentFile, "${file.name}.part")
