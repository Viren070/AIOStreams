plugins {
    id("aiostreams.android.library")
}

// On the classpath through build-logic, which a plugins block can't name.
apply(plugin = "org.jetbrains.kotlin.plugin.serialization")

android {
    namespace = "io.github.viren070.aiostreams.downloads"
}

dependencies {
    api(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
}
