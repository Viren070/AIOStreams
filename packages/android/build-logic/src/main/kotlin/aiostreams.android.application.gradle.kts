plugins {
    id("com.android.application")
    // Lists the Gradle libraries and their licences, for the page's licences list.
    id("com.mikepenz.aboutlibraries.plugin.android")
}

android {
    configureAndroid(project)
    defaultConfig {
        targetSdk = project.sdkVersion("android-targetSdk")
    }
}
