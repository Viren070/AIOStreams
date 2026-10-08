import com.android.build.api.dsl.CommonExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType

/** The SDK levels, NDK and Java version every module builds with. */
internal fun CommonExtension.configureAndroid(project: Project) {
    compileSdk {
        version = release(project.sdkVersion("android-compileSdk")) {
            minorApiLevel = project.sdkVersion("android-compileSdkMinor")
        }
    }
    defaultConfig.minSdk = project.sdkVersion("android-minSdk")
    // Also strips the native libraries the app packages.
    ndkVersion = project.catalogVersion("android-ndk")
    compileOptions.sourceCompatibility = JavaVersion.VERSION_17
    compileOptions.targetCompatibility = JavaVersion.VERSION_17
}

internal fun Project.sdkVersion(name: String): Int = catalogVersion(name).toInt()

private fun Project.catalogVersion(name: String): String =
    extensions.getByType<VersionCatalogsExtension>().named("libs").findVersion(name).get().requiredVersion
