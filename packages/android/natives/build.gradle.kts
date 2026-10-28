plugins {
    id("aiostreams.android.library")
}

android {
    namespace = "io.github.viren070.aiostreams.natives"
    defaultConfig {
        consumerProguardFiles("consumer-rules.pro")
    }
}

val native = layout.projectDirectory.dir("rust")
val rust = tasks.register<CargoNdkBuild>("buildRust") {
    workspace = native
    sources.from(fileTree(native) { exclude("target/**", "**/*.md") })
    crate = "aiostreams-native-android"
    abis = shippedAbis
    minSdk = checkNotNull(android.defaultConfig.minSdk)
    ndkVersion = android.ndkVersion
    ndk = androidComponents.sdkComponents.ndkDirectory
    jniLibs = layout.buildDirectory.dir("cargo/jniLibs")
}
val licenses = tasks.register<CargoAbout>("crateLicenses") {
    workspace = native
    sources.from(fileTree(native) { include("Cargo.lock", "about.toml", "**/Cargo.toml"); exclude("target/**") })
    assets = layout.buildDirectory.dir("cargo/assets")
}

androidComponents {
    onVariants { variant ->
        variant.sources.jniLibs?.addGeneratedSourceDirectory(rust, CargoNdkBuild::jniLibs)
        variant.sources.assets?.addGeneratedSourceDirectory(licenses, CargoAbout::assets)
    }
}
