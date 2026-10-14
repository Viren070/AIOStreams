package io.github.viren070.aiostreams

import android.content.Context
import android.text.InputType
import android.view.inputmethod.CompletionInfo
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView

/** A WebView whose focused field can offer the keyboard completions to show above its keys. */
class CompletingWebView(context: Context, private val tv: Boolean) : WebView(context) {
    fun showCompletions(names: List<String>) {
        val completions = names.mapIndexed { i, name -> CompletionInfo(i.toLong(), i, name) }.toTypedArray()
        context.getSystemService(InputMethodManager::class.java).displayCompletions(this, completions)
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs) ?: return null
        if (tv) outAttrs.inputType = nativeVariation(outAttrs.inputType)
        return object : InputConnectionWrapper(connection, false) {
            // Some keyboards swap the text themselves; one that calls this leaves it to the field.
            override fun commitCompletion(text: CompletionInfo): Boolean {
                val completion = text.text ?: return false
                beginBatchEdit()
                finishComposingText()
                performContextMenuAction(android.R.id.selectAll)
                commitText(completion, 1)
                endBatchEdit()
                return true
            }
        }
    }
}

/** TV keyboards span the screen for web fields, and float a compact panel over native ones. */
private fun nativeVariation(type: Int): Int {
    if (type and InputType.TYPE_MASK_CLASS != InputType.TYPE_CLASS_TEXT) return type
    val variation = when (type and InputType.TYPE_MASK_VARIATION) {
        InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT -> InputType.TYPE_TEXT_VARIATION_NORMAL
        InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS -> InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD -> InputType.TYPE_TEXT_VARIATION_PASSWORD
        else -> return type
    }
    return (type and InputType.TYPE_MASK_VARIATION.inv()) or variation
}
