plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.mpv"
    defaultConfig {
        consumerProguardFiles("consumer-rules.pro")
    }
}

val libmpv = tasks.register<FetchLibs>("fetchLibs") {
    pin = rootProject.layout.projectDirectory.file("libs.pin")
    classes = layout.buildDirectory.file("libmpv/classes.jar")
}

androidComponents {
    onVariants { variant ->
        variant.sources.jniLibs?.addGeneratedSourceDirectory(libmpv, FetchLibs::jniLibs)
        variant.sources.assets?.addGeneratedSourceDirectory(libmpv, FetchLibs::assets)
    }
}

dependencies {
    implementation(project(":playback"))
    api(files(libmpv.flatMap { it.classes }))
    implementation(libs.androidx.core)
    implementation(libs.kotlinx.coroutines.android)
}
