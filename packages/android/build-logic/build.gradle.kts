plugins {
    `kotlin-dsl`
}

dependencies {
    implementation(libs.android.gradle)
    // AGP's built-in Kotlin compiles with this version.
    implementation(libs.kotlin.gradle)
    implementation(libs.kotlin.serialization)
}
