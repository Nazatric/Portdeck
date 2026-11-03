package app.portdeck

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.window.CanvasBasedWindow
import kotlinx.coroutines.delay
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

external fun portdeckPick(kind: String)
external fun portdeckDemo(id: String)
external fun portdeckTakeProject(): String
external fun portdeckRecent(): String
external fun portdeckTakeLogs(): String
external fun portdeckShow(payload: String)
external fun portdeckHide()
external fun portdeckBounds(left: Double, top: Double, width: Double, height: Double)
external fun portdeckBooted()
external fun portdeckFullscreen(on: Boolean)
external fun portdeckViewport(width: Int, height: Int)
external fun portdeckSetVisible(on: Boolean)
external fun portdeckRequestSource(path: String)
external fun portdeckTakeSource(): String

@kotlinx.serialization.Serializable
private data class SourceReply(val path: String, val text: String)

private val json = Json { ignoreUnknownKeys = true }
private fun decode(value: String): DeckProject? = try { if (value.isEmpty()) null else json.decodeFromString<DeckProject>(value) } catch (_: Exception) { null }

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    CanvasBasedWindow("PortDeck", canvasElementId = "ComposeTarget") {
        var project by remember { mutableStateOf<DeckProject?>(null) }
        var recent by remember { mutableStateOf(decode(portdeckRecent())) }
        var error by remember { mutableStateOf("") }
        var logs by remember { mutableStateOf<List<String>>(emptyList()) }
        var reload by remember { mutableIntStateOf(0) }
        val pendingSources = remember { mutableMapOf<String, (String) -> Unit>() }
        LaunchedEffect(Unit) {
            portdeckBooted()
            while (true) {
                val incoming = decode(portdeckTakeProject())
                if (incoming != null) { project = incoming; if (!incoming.demo) recent = incoming; logs = emptyList() }
                val output = portdeckTakeLogs()
                if (output.isNotBlank()) {
                    if (project == null && output.startsWith("ERROR:")) error = output.removePrefix("ERROR:").trim()
                    else logs = (logs + output.split('\n')).takeLast(120)
                }
                while (true) {
                    val reply = portdeckTakeSource().takeIf { it.isNotEmpty() } ?: break
                    val parsed = try { json.decodeFromString<SourceReply>(reply) } catch (_: Exception) { null } ?: continue
                    pendingSources.remove(parsed.path)?.invoke(parsed.text)
                }
                delay(120)
            }
        }
        PortDeckApp(
            project, recent, error, logs,
            onPick = { portdeckPick(it) },
            onDemo = { portdeckDemo(it) },
            onOpenRecent = { project = recent; logs = emptyList() },
            onBack = { if (error.isNotEmpty()) error = "" else { portdeckHide(); project = null } },
            onReload = { reload++; logs = emptyList() },
            onImmersive = { portdeckFullscreen(it) },
            readSource = { file, done ->
                val inline = file.content
                if (inline != null) done(inline) else { pendingSources[file.path] = done; portdeckRequestSource(file.path) }
            },
            preview = { item, width, height, steady -> WasmPreview(item, reload, width, height, steady) },
        )
    }
}

@Composable
private fun WasmPreview(project: DeckProject, reload: Int, width: Int, height: Int, steady: Boolean) {
    LaunchedEffect(project, reload) { portdeckShow(json.encodeToString(project)) }
    LaunchedEffect(width, height) { portdeckViewport(width, height) }
    // The DOM preview cannot follow the canvas rotation, so it steps aside while the frame turns.
    LaunchedEffect(steady) { portdeckSetVisible(steady) }
    DisposableEffect(project.id) { onDispose { portdeckHide() } }
    Box(Modifier.fillMaxSize().onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        portdeckBounds(bounds.left.toDouble(), bounds.top.toDouble(), bounds.width.toDouble(), bounds.height.toDouble())
    })
}
