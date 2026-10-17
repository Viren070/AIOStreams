package io.github.viren070.aiostreams

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Before anything else runs, services included.
        Crashes.install(this)
    }
}
