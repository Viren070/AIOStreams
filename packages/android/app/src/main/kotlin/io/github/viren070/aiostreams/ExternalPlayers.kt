package io.github.viren070.aiostreams

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Video players an `intent:` link names, opened for a result: where they
 * stopped goes back to the page as the return link the link carried.
 */
class ExternalPlayers(private val activity: ComponentActivity, private val onReturn: (String) -> Unit) {
    /** The return link for the player open now, kept should Android end the app meanwhile. */
    private var back: String? = null
    /** The package the link named, when it did; what its answer means can depend on it. */
    private var app: String? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult(), ::finished)

    fun open(link: String) {
        val intent = try {
            Intent.parseUri(link, Intent.URI_INTENT_SCHEME)
        } catch (e: Exception) {
            Log.w(TAG, "bad intent link", e)
            return
        }
        // As a browser opens one: an action, a type and a package, never a component.
        intent.component = null
        intent.selector = null
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        back = intent.getStringExtra(RETURN)?.takeIf { it.startsWith("aiostreams://return/") }
        app = intent.`package`
        intent.removeExtra(RETURN)
        // MX Player says where it stopped only when asked to.
        intent.putExtra("return_result", true)
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            back = null
            val app = intent.`package` ?: return
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$app")))
            } catch (_: ActivityNotFoundException) {
            }
        }
    }

    fun save(state: Bundle) {
        state.putString(RETURN, back)
        state.putString(APP, app)
    }

    fun restore(state: Bundle?) {
        back = state?.getString(RETURN)
        app = state?.getString(APP)
    }

    private fun finished(result: ActivityResult) {
        val back = back ?: return
        this.back = null
        val data = result.data
        val extras = data?.extras ?: Bundle.EMPTY
        // Vimu says by its result code that it played to the end, and otherwise where it
        // stopped, after an error too. Newer builds name themselves in the action, which
        // covers Vimu picked as "Other app".
        val vimu = app in VIMU_PACKAGES || data?.action in VIMU_RESULTS
        // Most players say `position`, VLC `extra_position`, in ms; MX Player leaves it out
        // after playing to the end.
        val position = millis(extras, "position") ?: millis(extras, "extra_position")
        // Vimu's `duration` is -1 when it never got going and missing when it crashed, and a
        // stream it can't time puts its position past the end: none is a place worth keeping.
        val duration = millis(extras, "duration")
        val mark = when {
            vimu && result.resultCode == VIMU_COMPLETED -> "finished=1"
            vimu && (duration == null || duration <= 0 || position == null || position > duration) -> return
            extras.getString("end_by") == "playback_completion" -> "finished=1"
            position != null && position > 0 -> "position=${position / 1000.0}"
            else -> return
        }
        onReturn("$back&$mark")
    }

    private companion object {
        const val TAG = "players"
        const val RETURN = "aiostreams.return"
        const val APP = "aiostreams.app"

        /** Vimu and its free demo; their results carry the action `<package>.result`. */
        val VIMU_PACKAGES = setOf("net.gtvbox.videoplayer", "net.gtvbox.vimuhd")
        val VIMU_RESULTS = VIMU_PACKAGES.map { "$it.result" }.toSet()
        const val VIMU_COMPLETED = 1

        @Suppress("DEPRECATION")
        fun millis(extras: Bundle, key: String): Long? = (extras.get(key) as? Number)?.toLong()
    }
}
