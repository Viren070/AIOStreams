plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.exoplayer"

    defaultConfig {
        // The processors the app ships.
        ndk.abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
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
    implementation(libs.androidx.media3.ui)
    // FFmpeg's audio decoders, for what the device's own can't play, such as DTS and TrueHD.
    implementation(libs.jellyfin.media3.ffmpeg)
    // libmpv's libass draws the subtitles, with mpv's fallback font.
    implementation(project(":mpv"))
}
