plugins {
    id("com.android.application")
}

android {
    configureAndroid(project)
    defaultConfig {
        targetSdk = project.sdkVersion("android-targetSdk")
    }
}
