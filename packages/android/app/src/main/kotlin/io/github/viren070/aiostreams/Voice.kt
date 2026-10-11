package io.github.viren070.aiostreams

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class Voice(private val activity: ComponentActivity, private val send: (JsonObject) -> Unit) {
    private var recognizer: SpeechRecognizer? = null
    private val permission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) start() else ask()
    }
    private val dialog = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        finish(heard.takeIf { result.resultCode == Activity.RESULT_OK })
    }

    val available: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(activity) || hasDialog()

    fun listen() {
        when {
            !SpeechRecognizer.isRecognitionAvailable(activity) -> ask()
            activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> start()
            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun cancel() {
        val listening = recognizer ?: return
        listening.cancel()
        stop()
        finish(null)
    }

    fun release() = stop()

    private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)

    private fun hasDialog() = activity.packageManager.queryIntentActivities(intent(), 0).isNotEmpty()

    private fun ask() {
        try {
            dialog.launch(intent())
        } catch (_: ActivityNotFoundException) {
            finish(null)
        }
    }

    private fun start() {
        stop()
        val listening = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = listening
        var words: String? = null
        listening.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = hearing(0f, null)

            override fun onRmsChanged(rmsdB: Float) = hearing(((rmsdB + 2f) / 12f).coerceIn(0f, 1f), words)

            override fun onPartialResults(partialResults: Bundle?) {
                words = first(partialResults) ?: words
                hearing(null, words)
            }

            override fun onResults(results: Bundle?) {
                stop()
                finish(first(results) ?: words)
            }

            override fun onError(error: Int) {
                stop()
                when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> ask()
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> finish(null, "no-speech")
                    else -> finish(null, "failed")
                }
            }

            override fun onBeginningOfSpeech() = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        listening.startListening(intent().putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true))
    }

    private fun stop() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun first(results: Bundle?) =
        results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }

    private fun hearing(level: Float?, text: String?) = send(buildJsonObject {
        put("type", "voice-hearing")
        level?.let { put("level", it) }
        put("text", text)
    })

    private fun finish(text: String?, error: String? = null) = send(buildJsonObject {
        put("type", "voice-result")
        put("text", text)
        error?.let { put("error", it) }
    })
}
