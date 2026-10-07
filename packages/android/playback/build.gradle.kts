plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.playback"
}

dependencies {
    api(libs.kotlinx.serialization.json)
}
