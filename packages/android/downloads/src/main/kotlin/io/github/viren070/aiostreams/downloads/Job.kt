package io.github.viren070.aiostreams.downloads

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** What the page hands over: files to fetch and texts to write, at paths inside the folder. */
@Serializable
data class DownloadSpec(
    val id: String,
    val title: String,
    val versionId: String,
    val files: List<SpecFile>,
    val texts: List<SpecText> = emptyList(),
)

@Serializable
data class SpecFile(val url: String, val path: String, val kind: Kind)

@Serializable
data class SpecText(val path: String, val text: String)

@Serializable
enum class Kind {
    @SerialName("video") Video,
    @SerialName("subtitle") Subtitle,
    @SerialName("image") Image,
}

@Serializable
enum class State {
    @SerialName("queued") Queued,
    @SerialName("downloading") Downloading,
    @SerialName("paused") Paused,
    @SerialName("failed") Failed,
    @SerialName("done") Done,
}

@Serializable
internal data class Job(
    val spec: DownloadSpec,
    /** Where it was saved, as the folder for new downloads can change. */
    val folder: String,
    var state: State = State.Queued,
    var bytes: Long = 0,
    var total: Long? = null,
    var error: String? = null,
)

@Serializable
internal data class Saved(
    val concurrent: Int = 2,
    val wifiOnly: Boolean = true,
    val jobs: List<Job> = emptyList(),
)
