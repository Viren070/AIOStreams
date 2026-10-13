package io.github.viren070.aiostreams.playback

/** The page's sound settings that have no mpv property. */
data class Sound(
    /** Decibels the centre channel is raised by. */
    val dialogueBoost: Int = 0,
    val nightMode: Boolean = false,
    val ac3Encode: Boolean = false,
)
