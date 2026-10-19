plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.exoplayer"

    defaultConfig {
        ndk.abiFilters += shippedAbis
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = libs.versions.android.cmake.get()
        }
    }
}

dependencies {
    implementation(project(":playback"))
    api(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)
    // libmpv's libass draws the subtitles, with mpv's fallback font.
    implementation(project(":mpv"))
}
