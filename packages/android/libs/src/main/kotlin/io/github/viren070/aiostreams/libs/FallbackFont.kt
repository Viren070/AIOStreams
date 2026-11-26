package io.github.viren070.aiostreams.libs

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest

/** The font subtitles are drawn in where a script's own fonts are missing. */
object FallbackFont {
    private const val LEGACY_SIZE = 6_355_284L
    private const val LEGACY_SHA256 = "c09581ba3cd6afca6b614e7d4519d257f9738aa2f275650ba33214fea10e95ec"
    private var checkedFile: File? = null

    // In mpv's config folder, which is where mpv looks for it.
    @Synchronized
    fun file(context: Context): File {
        val font = File(File(context.filesDir, "mpv").apply { mkdirs() }, "subfont.ttf")
        if (!font.isFile || (checkedFile != font && isLegacyFont(font))) {
            val target = AtomicFile(font)
            val output = target.startWrite()
            try {
                context.resources.openRawResource(R.raw.subfont).use { it.copyTo(output) }
                target.finishWrite(output)
            } catch (error: Exception) {
                target.failWrite(output)
                throw error
            }
        }
        checkedFile = font
        return font
    }

    // Migrate the old bundled font without overwriting a user's replacement.
    private fun isLegacyFont(font: File): Boolean {
        if (font.length() != LEGACY_SIZE) return false
        val digest = MessageDigest.getInstance("SHA-256")
        font.inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) } == LEGACY_SHA256
    }
}
