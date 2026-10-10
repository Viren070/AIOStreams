plugins {
    id("aiostreams.android.application")
}

/** Copies the standalone web build under `web/`, beside the assets libraries bring. */
abstract class BundleWebApp : DefaultTask() {
    @get:InputDirectory
    abstract val source: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    init {
        // The web build replaces the folder, which Gradle's file-system watching can miss.
        outputs.upToDateWhen { false }
    }

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
        // CI names nightlies and counts builds; release-please keeps version.txt.
        versionName = providers.gradleProperty("aiostreams.version")
            .orElse(providers.fileContents(rootProject.layout.projectDirectory.file("version.txt")).asText.map(String::trim))
            .get()
        versionCode = providers.gradleProperty("aiostreams.versionCode").map(String::toInt).getOrElse(1)
        buildConfigField("String", "WEB_URL", "\"\"")
        val feed = providers.gradleProperty("aiostreams.updateFeed")
            .getOrElse("https://github.com/Viren070/AIOStreams/releases/download")
        buildConfigField("String", "UPDATE_FEED", "\"$feed\"")
        resValue("string", "app_name", "AIOStreams")
        val inspectable = providers.gradleProperty("aiostreams.inspectable").getOrElse("false")
        buildConfigField("boolean", "INSPECTABLE", inspectable)
    }

    // One APK per processor: libmpv for all of them would quadruple the download.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    signingConfigs {
        create("release") {
            providers.environmentVariable("ANDROID_KEYSTORE").orNull?.let { keystore ->
                storeFile = file(keystore)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        debug {
            // Beside a released copy, which a differently signed build can't replace.
            applicationIdSuffix = ".debug"
            resValue("string", "app_name", "AIOStreams Debug")
            val webUrl = providers.gradleProperty("aiostreams.webUrl").getOrElse("")
            buildConfigField("String", "WEB_URL", "\"$webUrl\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
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
    implementation(project(":mpv"))
    implementation(project(":exoplayer"))
    implementation(project(":downloads"))
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core)
    implementation(libs.androidx.media3.datasource)
    implementation(libs.androidx.media3.session)
    implementation(libs.androidx.webkit)
    implementation(libs.okhttp)
}
