package io.github.viren070.aiostreams

import android.app.Application
import io.github.viren070.aiostreams.logs.AppLog
import java.io.File

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Before anything else runs, services included.
        AppLog.open(File(filesDir, "logs"))
        Crashes.install(this)
    }
}
