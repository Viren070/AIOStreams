package io.github.viren070.aiostreams.exoplayer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

/** A live source retries a dropped connection longer and a refused link not at all; files keep Media3's own. */
@OptIn(UnstableApi::class)
internal class LoadErrorPolicy : DefaultLoadErrorHandlingPolicy() {
    @Volatile
    var live = false

    override fun getMinimumLoadableRetryCount(dataType: Int): Int =
        if (live) LIVE_RETRIES else super.getMinimumLoadableRetryCount(dataType)

    override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val code = (info.exception as? HttpDataSource.InvalidResponseCodeException)?.responseCode
        return if (live && code in REFUSED) C.TIME_UNSET else super.getRetryDelayMsFor(info)
    }

    private companion object {
        const val LIVE_RETRIES = 6
        val REFUSED = setOf(401, 403, 404, 410)
    }
}
