package io.github.viren070.aiostreams.playback

import android.app.ActivityManager
import android.content.Context
import kotlin.math.min

/**
 * How much of a stream a player holds in memory: the user's pick, else a share
 * of what the device can spare before it starts killing apps, little on a
 * small device.
 */
object CacheBudget {
    fun bytes(context: Context, limitMb: Int): Long {
        if (limitMb > 0) return limitMb * 1_000_000L
        val activities = context.getSystemService(ActivityManager::class.java)
        val memory = ActivityManager.MemoryInfo().also(activities::getMemoryInfo)
        val spare = (memory.availMem - memory.threshold).coerceAtLeast(0)
        var bytes = min(memory.totalMem / 8, spare / 4)
        if (small(context)) bytes = min(bytes, SMALL_MAX_BYTES)
        return bytes.coerceIn(MIN_BYTES, MAX_BYTES)
    }

    fun small(context: Context): Boolean {
        val activities = context.getSystemService(ActivityManager::class.java)
        val memory = ActivityManager.MemoryInfo().also(activities::getMemoryInfo)
        return activities.isLowRamDevice || memory.totalMem < SMALL_DEVICE_BYTES
    }

    private const val MIN_BYTES = 32L shl 20
    private const val MAX_BYTES = 512L shl 20
    private const val SMALL_MAX_BYTES = 96L shl 20

    /** Under this, a 3 GB device; 4 GB ones report more. */
    private const val SMALL_DEVICE_BYTES = 3_400_000_000L
}
