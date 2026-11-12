package io.github.viren070.aiostreams.logs

/**
 * [text] with its links' logins masked: an address's user, an Xtream login's path, secret
 * query values, and long encoded parts, which addons fill with their settings, keys among them.
 */
internal fun maskLinks(text: String): String = text.replace(LINK) { maskLink(it.value) }

private fun maskLink(url: String): String = url
    .replace(USER) { "${it.groupValues[1]}***@" }
    .replace(XTREAM) { "${it.groupValues[1]}/***/***/" }
    .replace(SECRET) { "${it.groupValues[1]}=***" }
    .replace(ENCODED, "/***")

private val LINK = Regex("https?://[^\\s'\"<>]+", RegexOption.IGNORE_CASE)
private val USER = Regex("^([a-z][a-z0-9+.-]*://)[^/@?#]+@", RegexOption.IGNORE_CASE)
private val XTREAM = Regex("(/(?:live|movie|series|timeshift|hls))/[^/?#]+/[^/?#]+/", RegexOption.IGNORE_CASE)
private val ENCODED = Regex("/[A-Za-z0-9_%=+-]{32,}(?=[/?#]|$)")
private val SECRET = Regex("([?&](?:password|pass|token|api_?key|key|auth)[^=&#]*)=[^&#]*", RegexOption.IGNORE_CASE)
