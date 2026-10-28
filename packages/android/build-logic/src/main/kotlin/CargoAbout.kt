import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File
import javax.inject.Inject
import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.provider.ProviderFactory
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations

/**
 * The Rust workspace's crates and their licence texts, `cargo about generate --format json` with the
 * workspace's `about.toml` cut down to what the app reads, as `third-party-licenses.json` in an assets
 * folder. Without cargo-about the folder stays empty, except on CI.
 */
@CacheableTask
abstract class CargoAbout @Inject constructor(
    private val exec: ExecOperations,
    providers: ProviderFactory,
) : DefaultTask() {
    @get:Internal
    abstract val workspace: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    /** Empty without cargo-about, so installing it runs the task again. */
    @get:Input
    abstract val version: Property<String>

    @get:OutputDirectory
    abstract val assets: DirectoryProperty

    init {
        version.convention(
            providers.exec {
                commandLine(cargo(), "about", "--version")
                isIgnoreExitValue = true
            }.standardOutput.asText.map(String::trim),
        )
    }

    @TaskAction
    @Suppress("UNCHECKED_CAST")
    fun generate() {
        val out = assets.get().asFile.apply {
            deleteRecursively()
            mkdirs()
        }
        if (version.get().isEmpty()) {
            check(System.getenv("CI") == null) { "cargo-about is missing, so the app would list no crates' licences" }
            logger.warn("cargo-about is missing, so the app lists no crates' licences: cargo install cargo-about")
            return
        }
        val about = File(temporaryDir, "about.json")
        exec.exec {
            workingDir = workspace.get().asFile
            commandLine(cargo(), "about", "generate", "--config", "about.toml", "--format", "json", "-o", about.path)
        }
        val licenses = (JsonSlurper().parse(about) as Map<String, Any?>)["licenses"] as List<Map<String, Any?>>
        val keep = listOf("name", "version", "license", "repository")
        val slim = licenses.map { licence ->
            mapOf(
                "text" to licence["text"],
                "used_by" to (licence["used_by"] as List<Map<String, Any?>>).map { use ->
                    mapOf("crate" to (use["crate"] as Map<String, Any?>).filterKeys { it in keep })
                },
            )
        }
        File(out, "third-party-licenses.json").writeText(JsonOutput.toJson(mapOf("licenses" to slim)))
    }
}
