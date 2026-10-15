package io.github.viren070.aiostreams.playback

import android.net.Uri
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** What the page may ask of the engine; the desktop app's allowlist, `core/src/bridge.rs`. */
object MpvProtocol {
    val observed = listOf(
        "time-pos", "duration", "demuxer-cache-time", "pause", "paused-for-cache", "seeking",
        "idle-active", "volume", "volume-max", "mute", "speed", "aid", "sid",
        "track-list", "chapter-list", "video-params", "container-fps",
    )

    val throttled = setOf("time-pos", "demuxer-cache-time")

    private val settable = setOf(
        "pause", "volume", "mute", "speed", "aid", "sid", "secondary-sid", "sub-delay",
        "audio-delay", "panscan", "keepaspect", "sub-scale", "sub-pos", "sub-visibility",
        "time-pos", "sub-bold", "sub-color", "sub-outline-color", "sub-outline-size",
        "sub-back-color", "sub-border-style", "sub-ass-override", "sub-ass-force-margins",
        "hwdec", "audio-channels", "audio-spdif",
    )

    private val loadfileOptions = setOf(
        "start", "aid", "sid", "alang", "alang-append", "slang", "slang-append", "force-media-title",
        "subs-fallback", "subs-fallback-forced", "subs-with-matching-audio",
    )

    private val statsBindings = setOf(
        "stats/display-stats-toggle", "stats/display-page-1-toggle", "stats/display-page-2-toggle",
        "stats/display-page-3-toggle", "stats/display-page-5-toggle",
    )

    private val seekFlags = setOf(
        "relative", "absolute", "absolute-percent", "relative-percent", "keyframes", "exact",
    )

    private val loadFlags = setOf("replace", "append", "append-play", "insert-next", "insert-next-play")

    fun command(raw: List<JsonElement>, isLocal: (String) -> Boolean): Result<List<String>> = runCatching {
        val args = raw.map(::argument)
        val name = args.firstOrNull() ?: error("empty command")
        when (name) {
            "loadfile" -> {
                require(args.getOrNull(1)?.let { isWebUrl(it) || isLocal(it) } == true) {
                    "loadfile takes an http(s) url or a download"
                }
                flags(args.getOrNull(2), loadFlags)
                number(args.getOrNull(3))
                args.getOrNull(4)?.let(::options)
                require(args.size <= 5) { "too many arguments" }
            }
            "sub-add", "audio-add" -> {
                require(args.getOrNull(1)?.let { isWebUrl(it) || isLocal(it) } == true) {
                    "$name takes an http(s) url or a download"
                }
                flags(args.getOrNull(2), setOf("select", "auto", "cached"))
                require(args.size <= 5) { "too many arguments" }
            }
            "sub-remove", "audio-remove" -> {
                number(args.getOrNull(1))
                require(args.size <= 2) { "too many arguments" }
            }
            "seek" -> {
                number(args.getOrNull(1))
                flags(args.getOrNull(2), seekFlags)
                require(args.size <= 3) { "too many arguments" }
            }
            "stop", "frame-step", "frame-back-step", "playlist-clear" ->
                require(args.size == 1) { "too many arguments" }
            "script-binding" ->
                require(args.size == 2 && args[1] in statsBindings) { "only the stats overlay's bindings are allowed" }
            "set", "cycle", "add" -> {
                require(args.getOrNull(1) in settable) { "$name is not allowed on that property" }
                require(args.size <= 3) { "too many arguments" }
            }
            else -> error("command $name is not allowed")
        }
        args
    }

    /** Adds the headers to a checked `loadfile` as its `http-header-fields` option. */
    fun withHeaders(args: List<String>, headers: JsonElement?): List<String> {
        val fields = (headers as? JsonObject).orEmpty().map { (name, value) ->
            val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
            // A backslash before the list's separator would escape it.
            require(isHeaderName(name) && text != null && text.all { it in ' '..'~' } && !text.endsWith('\\')) {
                "header $name is not allowed"
            }
            "$name: ${text.replace(",", "\\,")}"
        }
        if (fields.isEmpty()) return args
        require(args.first() == "loadfile") { "only loadfile takes headers" }
        val list = fields.joinToString(",")
        // The length prefix keeps the list's commas inside the one option.
        val option = "$HEADER_FIELDS=%${list.length}%$list"
        val full = args + listOf("replace", "-1", "").drop(args.size - 2)
        return full.take(4) + full[4].let { if (it.isEmpty()) option else "$it,$option" }
    }

    /** A `loadfile`'s options, reading a `%n%` length prefix as mpv does. */
    fun optionPairs(value: String): List<Pair<String, String>> {
        val pairs = mutableListOf<Pair<String, String>>()
        var rest = value
        while (rest.isNotEmpty()) {
            val key = rest.substringBefore('=')
            rest = rest.substringAfter('=', "")
            val prefix = LENGTH_PREFIX.matchAt(rest, 0)
            val text = if (prefix != null) {
                rest.drop(prefix.value.length).take(prefix.groupValues[1].toInt())
            } else {
                rest.substringBefore(',')
            }
            rest = rest.drop((prefix?.value?.length ?: 0) + text.length).removePrefix(",")
            pairs += key to text
        }
        return pairs
    }

    fun joinOptions(pairs: List<Pair<String, String>>): String =
        pairs.joinToString(",") { (key, value) -> if (',' in value) "$key=%${value.length}%$value" else "$key=$value" }

    fun headerFields(list: String?): Map<String, String> =
        list.orEmpty().split(UNESCAPED_COMMA).filter { ':' in it }.associate { field ->
            field.substringBefore(':') to field.substringAfter(':').trimStart().replace("\\,", ",")
        }

    const val HEADER_FIELDS = "http-header-fields"
    private val LENGTH_PREFIX = Regex("%(\\d+)%")
    private val UNESCAPED_COMMA = Regex("(?<!\\\\),")

    private fun isHeaderName(name: String) =
        name.isNotEmpty() && name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "!#\$%&'*+-.^_`|~" }

    fun setProperty(name: String, value: JsonElement): Result<String> = runCatching {
        require(name in settable) { "property $name is not settable" }
        argument(value)
    }

    private fun argument(value: JsonElement): String {
        val primitive = value as? JsonPrimitive ?: error("unsupported argument $value")
        primitive.booleanOrNull?.let { return if (it) "yes" else "no" }
        return primitive.contentOrNull ?: error("unsupported argument $value")
    }

    private fun isWebUrl(value: String) = Uri.parse(value).scheme in setOf("http", "https")

    private fun flags(value: String?, allowed: Set<String>) {
        if (value != null) require(value.split('+').all { it in allowed }) { "flags $value are not allowed" }
    }

    private fun number(value: String?) {
        if (value != null) requireNotNull(value.toDoubleOrNull()) { "$value is not a number" }
    }

    private fun options(value: String) {
        for (pair in value.split(',').filter { it.isNotEmpty() }) {
            val key = pair.substringBefore('=', "")
            require(key in loadfileOptions) { "option $key is not allowed" }
            // mpv reads %n% as a length prefix, which could smuggle in more options.
            require('%' !in pair.substringAfter('=')) { "option $key has an unsupported value" }
        }
    }
}
