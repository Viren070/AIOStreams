import java.io.File
import java.net.URI
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.zip.ZipFile
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/** Downloads the libmpv AAR `libmpv.pin` names, checks its SHA-256, and unpacks what the module builds with. */
abstract class FetchLibmpv : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val pin: RegularFileProperty

    @get:OutputDirectory
    abstract val jniLibs: DirectoryProperty

    @get:OutputDirectory
    abstract val assets: DirectoryProperty

    @get:OutputFile
    abstract val classes: RegularFileProperty

    @TaskAction
    fun fetch() {
        val values = pin.get().asFile.readLines()
            .filter { '=' in it && !it.startsWith("#") }
            .associate { it.substringBefore('=') to it.substringAfter('=') }
        val url = values.getValue("url")
        val expected = values.getValue("sha256")
        val aar = File(temporaryDir, "libmpv.aar")
        val digest = MessageDigest.getInstance("SHA-256")
        DigestInputStream(URI(url).toURL().openStream(), digest).use { input ->
            aar.outputStream().use { input.copyTo(it) }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        check(actual == expected) { "$url hashes to $actual, not the pinned $expected" }

        for (dir in listOf(jniLibs, assets)) dir.get().asFile.run { deleteRecursively(); mkdirs() }
        ZipFile(aar).use { zip ->
            for (entry in zip.entries()) {
                val target = when {
                    entry.isDirectory -> continue
                    entry.name.startsWith("jni/") -> jniLibs.file(entry.name.removePrefix("jni/"))
                    entry.name.startsWith("assets/") -> assets.file(entry.name.removePrefix("assets/"))
                    entry.name == "classes.jar" -> classes
                    else -> continue
                }.get().asFile
                target.parentFile.mkdirs()
                zip.getInputStream(entry).use { input -> target.outputStream().use { input.copyTo(it) } }
            }
        }
        aar.delete()
    }
}
