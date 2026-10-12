package io.github.viren070.aiostreams

import android.content.Context
import android.view.inputmethod.CompletionInfo
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView

/** A WebView whose focused field can offer the keyboard completions to show above its keys. */
class CompletingWebView(context: Context) : WebView(context) {
    fun showCompletions(names: List<String>) {
        val completions = names.mapIndexed { i, name -> CompletionInfo(i.toLong(), i, name) }.toTypedArray()
        context.getSystemService(InputMethodManager::class.java).displayCompletions(this, completions)
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs) ?: return null
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
