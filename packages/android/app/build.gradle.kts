plugins {
    id("aiostreams.android.application")
}

/** Copies the standalone web build under `web/`, beside the assets libraries bring. */
abstract class BundleWebApp : DefaultTask() {
    @get:InputDirectory
    abstract val source: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @TaskAction
    fun bundle() {
        val target = output.get().asFile.resolve("web")
        output.get().asFile.deleteRecursively()
        source.get().asFile.copyRecursively(target)
    }
}

val bundleWebApp = tasks.register<BundleWebApp>("bundleWebApp") {
    source.set(rootDir.resolve("../web/dist-standalone"))
    output.set(layout.buildDirectory.dir("generated/webApp"))
}

android {
    namespace = "io.github.viren070.aiostreams"

    defaultConfig {
        applicationId = "io.github.viren070.aiostreams"
        versionName = project.version.toString()
        versionCode = versionName!!.split('.').map(String::toInt).let { (major, minor, patch) ->
            (major * 10_000 + minor * 100 + patch) * 10
        }
        buildConfigField("String", "WEB_URL", "\"\"")
    }

    buildTypes {
        debug {
            val webUrl = providers.gradleProperty("aiostreams.webUrl").getOrElse("")
            buildConfigField("String", "WEB_URL", "\"$webUrl\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    buildFeatures {
        buildConfig = true
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(bundleWebApp, BundleWebApp::output)
    }
}

dependencies {
    implementation(project(":bridge"))
    implementation(project(":playback"))
    implementation(project(":engine-mpv"))
    implementation(project(":downloads"))
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core)
    implementation(libs.androidx.media3.datasource)
    implementation(libs.androidx.media3.session)
}
