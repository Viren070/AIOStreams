plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.mpv"
    defaultConfig {
        consumerProguardFiles("consumer-rules.pro")
    }
}

val libmpv = tasks.register<FetchLibmpv>("fetchLibmpv") {
    pin = rootProject.layout.projectDirectory.file("libmpv.pin")
    classes = layout.buildDirectory.file("libmpv/classes.jar")
}

androidComponents {
    onVariants { variant ->
        variant.sources.jniLibs?.addGeneratedSourceDirectory(libmpv, FetchLibmpv::jniLibs)
        variant.sources.assets?.addGeneratedSourceDirectory(libmpv, FetchLibmpv::assets)
    }
}

dependencies {
    implementation(project(":playback"))
    implementation(files(libmpv.flatMap { it.classes }))
    implementation(libs.androidx.core)
    implementation(libs.kotlinx.coroutines.android)
}
