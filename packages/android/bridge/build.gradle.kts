plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.bridge"
}

dependencies {
    api(libs.kotlinx.serialization.json)
    implementation(libs.androidx.webkit)
}
