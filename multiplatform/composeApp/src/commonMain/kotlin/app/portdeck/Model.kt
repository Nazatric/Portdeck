package app.portdeck

import kotlinx.serialization.Serializable

/** One file in a project manifest. [content] is only present for the built-in demos; imported files live on disk. */
@Serializable
data class DeckFile(val path: String, val size: Long = 0, val type: String = "", val content: String? = null)

@Serializable
data class DeckProject(
    val id: String,
    val name: String,
    val framework: String,
    val entry: String,
    val files: List<DeckFile>,
    val totalSize: Long = 0,
    val createdAt: Long = 0,
    val demo: Boolean = false,
)

fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    val rounded = if (value >= 100) value.toLong().toString() else ((value * 10).toLong() / 10.0).toString()
    return "$rounded ${units[unit]}"
}
