package io.github.viren070.aiostreams

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.add
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * The licences of what the app ships besides the page, in the page's list shape: the libs AAR's
 * native libraries, the Rust crates in the app's own native library, and the Gradle libraries.
 */
class Licenses private constructor(private val context: Context) {
    private val texts = mutableListOf<String>()
    private val libraries = mutableListOf<JsonObject>()

    private fun text(text: String): Int = texts.size.also { texts += text.trim() }

    private fun library(name: String, version: String?, licence: String?, url: String?, ids: List<Int>) {
        libraries += buildJsonObject {
            put("name", name)
            version?.let { put("version", it) }
            licence?.let { put("licence", it) }
            url?.let { put("url", it) }
            putJsonArray("texts") { ids.forEach { add(it) } }
        }
    }

    private fun asset(path: String): String? =
        runCatching { context.assets.open(path).bufferedReader().use { it.readText() } }.getOrNull()

    /** The libs release's `licenses/index.json`, with each library's files in `licenses/<name>/`. */
    private fun natives() {
        val index = asset("licenses/index.json")?.let(Json::parseToJsonElement) ?: return
        for (entry in index.jsonObject.getValue("libraries").jsonArray) {
            val name = entry.string("name") ?: continue
            val pins = entry.jsonObject["pins"]?.jsonObject.orEmpty()
            // shaderc pins its dependencies too.
            val version = (pins["v_" + name.replace('-', '_')] ?: pins.values.firstOrNull())?.jsonPrimitive?.contentOrNull
            val ids = entry.jsonObject["files"]?.jsonArray.orEmpty()
                .mapNotNull { file -> asset("licenses/$name/${file.jsonPrimitive.content}")?.let(::text) }
            library(name, version, null, null, ids)
        }
    }

    /** `cargo about generate --format json`: each licence text with the crates under it. */
    private fun crates() {
        val about = asset("third-party-licenses.json")?.let(Json::parseToJsonElement) ?: return
        val crates = linkedMapOf<String, Pair<JsonObject, MutableList<Int>>>()
        for (licence in about.jsonObject.getValue("licenses").jsonArray) {
            val id = text(licence.string("text").orEmpty())
            for (use in licence.jsonObject.getValue("used_by").jsonArray) {
                val crate = use.jsonObject.getValue("crate").jsonObject
                crates.getOrPut("${crate.string("name")}@${crate.string("version")}") { crate to mutableListOf() }.second += id
            }
        }
        for ((crate, ids) in crates.values) {
            val name = crate.string("name") ?: continue
            library(name, crate.string("version"), crate.string("license"),
                crate.string("repository") ?: "https://crates.io/crates/$name", ids)
        }
    }

    /** AboutLibraries' list of the Gradle libraries, with each licence's text once. */
    private fun gradle() {
        val json = runCatching {
            context.resources.openRawResource(R.raw.aboutlibraries).bufferedReader().use { it.readText() }
        }.getOrNull()?.let(Json::parseToJsonElement) ?: return
        val licences = json.jsonObject["licenses"]?.jsonObject.orEmpty()
        val ids = licences.mapValues { (_, licence) -> text(licence.string("content").orEmpty()) }
        for (entry in json.jsonObject.getValue("libraries").jsonArray) {
            val keys = entry.jsonObject["licenses"]?.jsonArray.orEmpty().map { it.jsonPrimitive.content }
            library(
                entry.string("uniqueId") ?: continue,
                entry.string("artifactVersion"),
                keys.joinToString(" OR ").ifEmpty { null },
                entry.string("website") ?: entry.jsonObject["scm"]?.string("url"),
                keys.mapNotNull(ids::get),
            )
        }
    }

    private fun answer() = buildJsonObject {
        put("type", "licenses")
        putJsonArray("texts") { texts.forEach { add(it) } }
        putJsonArray("libraries") { libraries.forEach { add(it) } }
    }

    companion object {
        /** Reads every list; call it off the main thread. */
        fun answer(context: Context): JsonObject = Licenses(context).apply {
            natives()
            crates()
            gradle()
        }.answer()
    }
}

private fun JsonElement.string(key: String): String? = jsonObject[key]?.jsonPrimitive?.contentOrNull
