plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.mpv"
}

dependencies {
    implementation(project(":playback"))
    api(project(":libs"))
    implementation(libs.androidx.core)
    implementation(libs.kotlinx.coroutines.android)
}
