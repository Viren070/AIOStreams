package io.github.viren070.aiostreams

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.util.Rational
import android.view.View
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.annotation.RequiresApi
import androidx.media3.common.VideoSize

/** The video in a small window of its own, entered on leaving the app while it plays. */
class PictureInPicture(private val activity: Activity, private val video: View) {
    @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.O)
    private val supported = supported(activity)
    private var allowed = false
    private var size = VideoSize.UNKNOWN

    fun update(allowed: Boolean, size: VideoSize) {
        if (!supported || (allowed == this.allowed && size == this.size)) return
        this.allowed = allowed
        this.size = size
        activity.setPictureInPictureParams(params())
    }

    /** Android 12 and later enter on their own. */
    fun onUserLeaveHint() {
        if (supported && allowed && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) activity.enterPictureInPictureMode(params())
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun params(): PictureInPictureParams {
        val params = PictureInPictureParams.Builder()
        if (size.width > 0 && size.height > 0) {
            val ratio = size.width.toFloat() * size.pixelWidthHeightRatio / size.height
            // Android refuses shapes beyond these.
            val shown = ratio.coerceIn(1 / MAX_RATIO, MAX_RATIO)
            params.setAspectRatio(Rational((shown * 10_000).toInt(), 10_000))
            params.setSourceRectHint(videoRect(ratio))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setAutoEnterEnabled(allowed).setSeamlessResizeEnabled(false)
        }
        return params.build()
    }

    /** Where mpv draws the picture in the view, fitted with bars. */
    private fun videoRect(ratio: Float): Rect {
        val width = video.width
        val height = video.height
        if (width == 0 || height == 0) return Rect()
        return if (width.toFloat() / height > ratio) {
            val shown = (height * ratio).toInt()
            Rect((width - shown) / 2, 0, (width + shown) / 2, height)
        } else {
            val shown = (width / ratio).toInt()
            Rect(0, (height - shown) / 2, width, (height + shown) / 2)
        }
    }

    companion object {
        private const val MAX_RATIO = 2.39f

        /** Android 7 had it on TVs only, without the window's shape. */
        @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.O)
        fun supported(context: Context) =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }
}
