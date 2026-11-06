package app.portdeck

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/** Serves imported projects from app storage at /project/<id>/<path>, with headers the sandboxed preview needs. */
private class ProjectFiles(private val root: File) : WebViewAssetLoader.PathHandler {
    private val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cross-Origin-Resource-Policy" to "cross-origin", "Cache-Control" to "no-cache")
    override fun handle(path: String): WebResourceResponse {
        val file = File(root, path).canonicalFile
        if (!file.path.startsWith(root.canonicalPath + File.separator) || !file.isFile) {
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, ByteArrayInputStream(ByteArray(0)))
        }
        return WebResourceResponse(mimeFor(file.name), null, 200, "OK", headers + ("Content-Length" to file.length().toString()), FileInputStream(file))
    }
}

private val projectJson = Json { ignoreUnknownKeys = true }

class MainActivity : ComponentActivity() {
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private val uploadPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        uploadCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        uploadCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        requestHighestRefreshRate()
        setContent {
            var project by remember { mutableStateOf<DeckProject?>(null) }
            var projects by remember { mutableStateOf(readProjects()) }
            var error by remember { mutableStateOf("") }
            var logs by remember { mutableStateOf<List<String>>(emptyList()) }
            var reload by remember { mutableIntStateOf(0) }
            val scope = rememberCoroutineScope()

            fun openImported(load: () -> DeckProject) {
                scope.launch {
                    try {
                        val imported = withContext(Dispatchers.IO) { load() }
                        withContext(Dispatchers.IO) { persistProjects(listOf(imported) + projects.filterNot { it.id == imported.id }) }
                        projects = listOf(imported) + projects.filterNot { it.id == imported.id }
                        project = imported
                        logs = emptyList()
                    } catch (failure: Exception) {
                        error = failure.message ?: "Could not import this project."
                    }
                }
            }

            fun deleteProject(target: DeckProject) {
                scope.launch {
                    withContext(Dispatchers.IO) {
                        File(filesDir, "projects/${target.id}").deleteRecursively()
                        persistProjects(projects.filterNot { it.id == target.id })
                    }
                    projects = projects.filterNot { it.id == target.id }
                    if (project?.id == target.id) {
                        project = null
                        logs = emptyList()
                    }
                }
            }

            val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
                if (uri != null) {
                    try {
                        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    } catch (_: Exception) { }
                    openImported { ProjectReader(this).folder(uri) }
                }
            }
            val zipPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) openImported { ProjectReader(this).zip(uri) } }
            val filesPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) openImported { ProjectReader(this).files(uris) } }

            // System back returns to the library instead of closing the app.
            BackHandler(enabled = project != null || error.isNotEmpty()) {
                if (error.isNotEmpty()) {
                    error = ""
                } else {
                    project = null
                    logs = emptyList()
                }
            }

            PortDeckApp(
                project = project, projects = projects, error = error, logs = logs,
                onPick = { kind ->
                    when (kind) {
                        "folder" -> folderPicker.launch(null)
                        "zip" -> zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream"))
                        else -> filesPicker.launch(arrayOf("*/*"))
                    }
                },
                onDemo = { id ->
                    try {
                        project = projectJson.decodeFromString<List<DeckProject>>(assets.open("demos.json").bufferedReader().readText()).first { it.id == id }
                        logs = emptyList()
                    } catch (failure: Exception) {
                        error = failure.message ?: "Could not open the demo."
                    }
                },
                onOpenProject = { target ->
                    project = target
                    logs = emptyList()
                },
                onDeleteProject = ::deleteProject,
                onBack = {
                    if (error.isNotEmpty()) {
                        error = ""
                    } else {
                        project = null
                        logs = emptyList()
                    }
                },
                onReload = {
                    reload++
                    logs = emptyList()
                },
                onImmersive = { setSystemBarsHidden(it) },
                readSource = { file, done ->
                    val inline = file.content
                    val current = project
                    if (inline != null || current == null) {
                        done(inline ?: "")
                    } else {
                        scope.launch {
                            done(
                                withContext(Dispatchers.IO) {
                                    val target = File(filesDir, "projects/${current.id}/${file.path}")
                                    val textual = file.type.startsWith("text/") || file.type.contains("json") || file.type.contains("javascript") || file.type.contains("xml") || file.type.contains("svg")
                                    if (!textual || !target.isFile) "" else target.inputStream().use { input -> String(input.readNBytesCompat(3 * 1024 * 1024)) }
                                },
                            )
                        }
                    }
                },
                preview = { item, width, height, _ -> NativePreview(item, reload, width, height) { message -> logs = (logs + message).takeLast(120) } },
            )
        }
    }

    /** Many phones keep apps at 60 Hz unless asked; request the panel's fastest mode at the current resolution. */
    private fun requestHighestRefreshRate() {
        val screen = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display
        } else {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay
        }
        val current = screen?.mode ?: return
        val fastest = screen.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .maxByOrNull { it.refreshRate } ?: return
        window.attributes = window.attributes.apply { preferredDisplayModeId = fastest.modeId }
    }

    private fun setSystemBarsHidden(on: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun readProjects(): List<DeckProject> = try {
        projectJson.decodeFromString<List<DeckProject>>(filesDir.resolve("projects.json").readText())
    } catch (_: Exception) {
        // One-time migration of the old single-recent-project store.
        runCatching {
            val legacy = projectJson.decodeFromString<DeckProject>(filesDir.resolve("recent-project.json").readText())
            listOf(legacy).also(::persistProjects)
        }.getOrDefault(emptyList())
    }

    private fun persistProjects(list: List<DeckProject>) {
        try {
            filesDir.resolve("projects.json").writeText(projectJson.encodeToString(list))
        } catch (_: Exception) { }
    }

    private fun chooseUpload(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean = try {
        uploadCallback?.onReceiveValue(null)
        uploadCallback = callback
        uploadPicker.launch(params.createIntent())
        true
    } catch (_: Exception) {
        uploadCallback = null
        false
    }

    private inner class EngineBridge(private val id: String, private val onLog: (String) -> Unit) {
        fun readStorage(): String = getSharedPreferences("preview-storage", MODE_PRIVATE).getString(id, "{}") ?: "{}"

        fun onMessage(value: String) {
            val parsed = try {
                JSONObject(value)
            } catch (_: Exception) {
                JSONObject()
            }
            val type = parsed.optString("type")
            if (type == "storage") {
                val storage = parsed.optJSONObject("data")?.toString() ?: "{}"
                if (storage.length < 500_000) getSharedPreferences("preview-storage", MODE_PRIVATE).edit().putString(id, storage).apply()
            }
            val text = parsed.optString("text")
            val message = when (type) {
                "error" -> "ERROR: $text"
                "warn", "warning" -> "WARN: $text"
                else -> text
            }
            runOnUiThread { if (text.isNotBlank()) onLog(message) }
        }
    }

    private fun injectChunks(view: WebView, variable: String, value: String) {
        var offset = 0
        while (offset < value.length) {
            var end = minOf(offset + 32 * 1024, value.length)
            if (end < value.length && Character.isHighSurrogate(value[end - 1])) end--
            view.evaluateJavascript("window.$variable+=${JSONObject.quote(value.substring(offset, end))};", null)
            offset = end
        }
    }

    private fun InputStream.readNBytesCompat(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (out.size() < limit) {
            val count = read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (count < 0) break
            out.write(buffer, 0, count)
        }
        return out.toByteArray()
    }

    @Composable
    private fun NativePreview(project: DeckProject, reload: Int, width: Int, height: Int, onLog: (String) -> Unit) {
        val viewport = remember { intArrayOf(0, 0) }
        viewport[0] = width
        viewport[1] = height
        val context = LocalContext.current
        val payload = remember(project) { projectJson.encodeToString(project) }
        val bridge = remember(project) { EngineBridge(project.id, onLog) }
        val webView = remember(project) {
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.WHITE)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    WebViewCompat.addWebMessageListener(this, "PortDeckNative", setOf("https://appassets.androidplatform.net")) { _, message, _, isMainFrame, _ ->
                        if (isMainFrame) bridge.onMessage(message.data ?: "")
                    }
                } else {
                    post { onLog("WARN: Update Android System WebView to enable console output and preview storage.") }
                }
                val loader = WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                    .addPathHandler("/project/", ProjectFiles(File(context.filesDir, "projects")))
                    .build()
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
                    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                        // Never let a renderer death kill the app; the preview goes blank, so say so in the console.
                        val reason = if (detail.didCrash()) "crashed" else "was killed (likely out of memory)"
                        onLog("ERROR: The preview renderer $reason. Go back and reopen the project to restart it.")
                        return true
                    }
                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                        if (request.isForMainFrame) onLog("ERROR: Failed to load the preview page: ${error.description}.")
                    }
                    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                        if (request.isForMainFrame && (errorResponse?.statusCode ?: 200) >= 400) onLog("ERROR: The preview page returned HTTP ${errorResponse?.statusCode}.")
                    }
                    override fun onPageFinished(view: WebView, url: String) {
                        onLog("Preview engine page loaded.")
                        view.evaluateJavascript("window.portdeckViewport(${viewport[0]},${viewport[1]});window.__pdPayload='';window.__pdStorage='';", null)
                        injectChunks(view, "__pdPayload", payload)
                        injectChunks(view, "__pdStorage", bridge.readStorage())
                        view.evaluateJavascript("window.portdeckBuild(window.__pdPayload,window.__pdStorage);window.__pdPayload='';window.__pdStorage='';", null)
                    }
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        if (request.isForMainFrame && request.url.scheme in listOf("http", "https") && request.url.host != "appassets.androidplatform.net") {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                            } catch (_: Exception) { }
                            return true
                        }
                        return false
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean = chooseUpload(callback, params)
                    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                        // The preview engine reports through the bridge; relay raw page errors/warnings too, they are otherwise invisible.
                        when (message.messageLevel()) {
                            ConsoleMessage.MessageLevel.ERROR -> onLog("ERROR: ${message.message()}")
                            ConsoleMessage.MessageLevel.WARNING -> onLog("WARN: ${message.message()}")
                            else -> Unit
                        }
                        return true
                    }
                }
            }
        }
        DisposableEffect(webView) { onDispose { webView.destroy() } }
        LaunchedEffect(width, height) { webView.evaluateJavascript("window.portdeckViewport&&window.portdeckViewport($width,$height)", null) }
        AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize(), update = { view ->
            val key = "${project.id}:$reload"
            if (view.tag != key) {
                view.tag = key
                view.loadUrl("https://appassets.androidplatform.net/assets/engine/index.html")
            }
        })
    }
}
