package io.github.viren070.aiostreams

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.TvContractCompat.WatchNextPrograms
import androidx.tvprovider.media.tv.WatchNextProgram
import java.util.concurrent.Executors
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The TV home screen's Watch Next row, filled with the list the page sends,
 * which replaces the app's whole part of it.
 */
class WatchNext(context: Context) {
    private val context = context.applicationContext
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "watch-next") }
    private val leanback = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

    private class Entry(
        val id: String,
        val episode: Boolean,
        val title: String,
        val episodeTitle: String?,
        val season: Int?,
        val number: Int?,
        val description: String?,
        val image: String?,
        val positionMs: Int,
        val durationMs: Int?,
        val playedAt: Long?,
        val link: String,
    )

    private class Row(val id: Long, val values: Map<String, String?>) {
        val key get() = values[WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID]
        val browsable get() = values[WatchNextPrograms.COLUMN_BROWSABLE] == "1"
        val engagedAt get() = values[WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS]?.toLongOrNull() ?: 0
    }

    fun publish(items: List<JsonObject>) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !leanback) return
        val entries = items.mapNotNull(::entryOf)
        worker.execute {
            runCatching { sync(entries) }.onFailure { Log.w(TAG, "updating the row", it) }
        }
    }

    private fun entryOf(item: JsonObject): Entry? {
        fun string(key: String) = (item[key] as? JsonPrimitive)?.contentOrNull
        fun int(key: String) = (item[key] as? JsonPrimitive)?.intOrNull
        return Entry(
            id = string("id") ?: return null,
            episode = string("kind") == "episode",
            title = string("title") ?: return null,
            episodeTitle = string("episodeTitle"),
            season = int("season"),
            number = int("episode"),
            description = string("description"),
            image = string("image"),
            positionMs = int("positionMs") ?: 0,
            durationMs = int("durationMs"),
            playedAt = (item["playedAt"] as? JsonPrimitive)?.longOrNull,
            link = string("link") ?: return null,
        )
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun sync(entries: List<Entry>) {
        val resolver = context.contentResolver
        val wanted = entries.associateBy { it.id }
        val placed = mutableSetOf<String>()
        for (row in rows()) {
            val uri = TvContractCompat.buildWatchNextProgramUri(row.id)
            val entry = wanted[row.key]?.takeIf { it.id !in placed }
            // One the user removed stays away until it is played again.
            if (entry == null || !row.browsable && (entry.playedAt ?: 0) > row.engagedAt) {
                resolver.delete(uri, null, null)
                continue
            }
            placed += entry.id
            if (!row.browsable) continue
            val values = values(entry, row.engagedAt)
            if (values.keySet().any { values.getAsString(it) != row.values[it] }) {
                resolver.update(uri, values, null, null)
            }
        }
        // A next episode counts from when it first shows, in the page's order.
        val now = System.currentTimeMillis()
        val added = entries.withIndex()
            .filter { it.value.id !in placed }
            .map { (i, entry) -> values(entry, now - i) }
        if (added.isNotEmpty()) resolver.bulkInsert(WatchNextPrograms.CONTENT_URI, added.toTypedArray())
    }

    /** Only this app's own programs come back. */
    private fun rows(): List<Row> =
        context.contentResolver.query(WatchNextPrograms.CONTENT_URI, null, null, null, null)?.use { c ->
            val id = c.getColumnIndexOrThrow(WatchNextPrograms._ID)
            val columns = c.columnNames.withIndex()
            buildList {
                while (c.moveToNext()) {
                    val values = columns.filter { c.getType(it.index) != Cursor.FIELD_TYPE_BLOB }
                        .associate { (i, name) -> name to c.getString(i) }
                    add(Row(c.getLong(id), values))
                }
            }
        }.orEmpty()

    /** With what the entry leaves out cleared, as an update keeps any column it doesn't name. */
    private fun values(entry: Entry, engagedAt: Long) = program(entry, engagedAt).toContentValues().apply {
        for (column in OPTIONAL) if (!containsKey(column)) putNull(column)
    }

    private fun program(entry: Entry, engagedAt: Long): WatchNextProgram {
        // Named in full, so a debug build beside a release one opens itself.
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(entry.link), context, MainActivity::class.java)
        return WatchNextProgram.Builder()
            .setInternalProviderId(entry.id)
            .setWatchNextType(
                if (entry.positionMs > 0) WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE
                else WatchNextPrograms.WATCH_NEXT_TYPE_NEXT,
            )
            .setLastEngagementTimeUtcMillis(entry.playedAt ?: engagedAt)
            .setType(if (entry.episode) WatchNextPrograms.TYPE_TV_EPISODE else WatchNextPrograms.TYPE_MOVIE)
            .setTitle(entry.title)
            .setPosterArtAspectRatio(WatchNextPrograms.ASPECT_RATIO_16_9)
            .setIntent(intent)
            .apply {
                entry.episodeTitle?.let { setEpisodeTitle(it) }
                entry.season?.let { setSeasonNumber(it) }
                entry.number?.let { setEpisodeNumber(it) }
                entry.description?.let { setDescription(it) }
                entry.image?.let { setPosterArtUri(Uri.parse(it)) }
                entry.durationMs?.let { setDurationMillis(it) }
                if (entry.positionMs > 0) setLastPlaybackPositionMillis(entry.positionMs)
            }
            .build()
    }

    private companion object {
        const val TAG = "watch-next"
        val OPTIONAL = arrayOf(
            WatchNextPrograms.COLUMN_EPISODE_TITLE,
            WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER,
            WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER,
            WatchNextPrograms.COLUMN_SHORT_DESCRIPTION,
            WatchNextPrograms.COLUMN_POSTER_ART_URI,
            WatchNextPrograms.COLUMN_DURATION_MILLIS,
            WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS,
        )
    }
}
