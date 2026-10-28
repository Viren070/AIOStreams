plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.libs"
    defaultConfig {
        consumerProguardFiles("consumer-rules.pro")
    }
}

val aar = tasks.register<FetchLibs>("fetchLibs") {
    pin = rootProject.layout.projectDirectory.file("libs.pin")
    classes = layout.buildDirectory.file("libs/classes.jar")
}

androidComponents {
    onVariants { variant ->
        variant.sources.jniLibs?.addGeneratedSourceDirectory(aar, FetchLibs::jniLibs)
        variant.sources.assets?.addGeneratedSourceDirectory(aar, FetchLibs::assets)
    }
}

dependencies {
    api(files(aar.flatMap { it.classes }))
    implementation(libs.androidx.core)
    implementation(libs.kotlinx.coroutines.android)
}
