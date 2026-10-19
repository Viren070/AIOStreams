import java.io.File
import javax.inject.Inject
import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations

/** Builds a crate of the Rust workspace with cargo-ndk, one shared library per ABI, laid out as jniLibs. */
@CacheableTask
abstract class CargoNdkBuild @Inject constructor(private val exec: ExecOperations) : DefaultTask() {
    @get:Internal
    abstract val workspace: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:Input
    abstract val crate: Property<String>

    @get:Input
    abstract val abis: ListProperty<String>

    @get:Input
    abstract val minSdk: Property<Int>

    @get:Internal
    abstract val ndk: DirectoryProperty

    @get:Input
    abstract val ndkVersion: Property<String>

    @get:OutputDirectory
    abstract val jniLibs: DirectoryProperty

    @TaskAction
    fun build() {
        val out = jniLibs.get().asFile.apply {
            deleteRecursively()
            mkdirs()
        }
        exec.exec {
            workingDir = workspace.get().asFile
            environment("ANDROID_NDK_HOME", ndk.get().asFile.path)
            commandLine(
                listOf(cargo(), "ndk", "--platform", minSdk.get().toString()) +
                    abis.get().flatMap { listOf("-t", it) } +
                    listOf("-o", out.path, "build", "--release", "-p", crate.get()),
            )
        }
    }

    /** rustup's cargo, which has the Android targets, ahead of any other Rust on the PATH. */
    private fun cargo(): String {
        val home = System.getenv("CARGO_HOME")?.let(::File) ?: File(System.getProperty("user.home"), ".cargo")
        val name = if (System.getProperty("os.name").startsWith("Windows")) "cargo.exe" else "cargo"
        return File(home, "bin/$name").takeIf { it.exists() }?.path ?: "cargo"
    }
}
