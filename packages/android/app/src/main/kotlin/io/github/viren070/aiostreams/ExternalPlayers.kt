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

    fun save(state: Bundle) = state.putString(RETURN, back)

    fun restore(state: Bundle?) {
        back = state?.getString(RETURN)
    }

    private fun finished(result: ActivityResult) {
        val back = back ?: return
        this.back = null
        val extras = result.data?.extras ?: return
        // Most players say `position`, VLC `extra_position`, in ms; MX Player leaves it out
        // after playing to the end.
        val position = millis(extras, "position") ?: millis(extras, "extra_position")
        val mark = when {
            extras.getString("end_by") == "playback_completion" -> "finished=1"
            position != null && position > 0 -> "position=${position / 1000.0}"
            else -> return
        }
        onReturn("$back&$mark")
    }

    private companion object {
        const val TAG = "players"
        const val RETURN = "aiostreams.return"

        @Suppress("DEPRECATION")
        fun millis(extras: Bundle, key: String): Long? = (extras.get(key) as? Number)?.toLong()
    }
}
