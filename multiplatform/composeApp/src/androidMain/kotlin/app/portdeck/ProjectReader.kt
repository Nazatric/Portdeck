package app.portdeck

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

private val skippedDirs = setOf("node_modules", ".git", ".svn", ".hg", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".netlify", ".cache", ".parcel-cache", ".angular", "__MACOSX")
private val skippedFiles = setOf(".DS_Store", "Thumbs.db", "desktop.ini")
private val builtDirs = listOf("dist", "build", "out", "docs", "www", "public", "site", "_site", "dist/browser", "build/web")
private val unsupportedSources = listOf("vue", "svelte", "@angular/core", "solid-js", "astro", "nuxt", "@sveltejs/kit", "preact", "lit", "@remix-run/react", "gatsby")

fun mimeFor(path: String): String {
    val ext = path.substringAfterLast('.', "").lowercase()
    return when (ext) {
        "js", "mjs", "cjs", "jsx", "ts", "tsx" -> "text/javascript"
        "css" -> "text/css"; "html", "htm" -> "text/html"; "json", "map" -> "application/json"
        "svg" -> "image/svg+xml"; "wasm" -> "application/wasm"; "webmanifest" -> "application/manifest+json"
        "woff2" -> "font/woff2"; "woff" -> "font/woff"; "ttf" -> "font/ttf"; "otf" -> "font/otf"
        else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }
}

/**
 * Streams an imported project into app storage file by file. There is no size or file-count limit; the only
 * bound is free space on the device. The WebView later reads files straight from disk.
 */
class ProjectReader(private val context: Context) {
    private val id = "project-${System.currentTimeMillis().toString(36)}"
    private val root = File(context.filesDir, "projects").apply { mkdirs() }
    private val staging = File(root, "$id.partial")
    private val written = mutableListOf<DeckFile>()

    private fun clean(raw: String): String? {
        val parts = raw.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty()) return null
        require(parts.none { it == ".." }) { "This project contains an unsafe path and was not imported." }
        if (parts.any { it in skippedDirs } || parts.last() in skippedFiles) return null
        return parts.joinToString("/")
    }

    private fun write(rawPath: String, input: InputStream) {
        val path = clean(rawPath) ?: return
        val target = File(staging, path)
        require(target.canonicalPath.startsWith(staging.canonicalPath + File.separator)) { "This project contains an unsafe path and was not imported." }
        target.parentFile?.mkdirs()
        val size = target.outputStream().use { input.copyTo(it, 64 * 1024) }
        written.add(DeckFile(path, size, mimeFor(path)))
    }

    fun folder(uri: Uri): DeckProject = guarded {
        val tree = DocumentFile.fromTreeUri(context, uri) ?: error("Could not open this folder.")
        fun walk(directory: DocumentFile, prefix: String) {
            for (file in directory.listFiles()) {
                val name = file.name ?: continue
                if (file.isDirectory) { if (name !in skippedDirs) walk(file, "$prefix$name/") }
                else if (file.isFile) context.contentResolver.openInputStream(file.uri)?.use { write("$prefix$name", it) }
            }
        }
        walk(tree, "")
        finish(tree.name ?: "Imported project")
    }

    fun zip(uri: Uri): DeckProject = guarded {
        val name = DocumentFile.fromSingleUri(context, uri)?.name?.removeSuffix(".zip") ?: "Imported project"
        val stream = context.contentResolver.openInputStream(uri) ?: error("Could not open this ZIP.")
        ZipInputStream(stream.buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory) write(entry.name, zip)
                zip.closeEntry()
            }
        }
        finish(name)
    }

    fun files(uris: List<Uri>): DeckProject = guarded {
        for (uri in uris) {
            val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "file-${written.size}"
            context.contentResolver.openInputStream(uri)?.use { write(name, it) }
        }
        finish(if (uris.size == 1) written.firstOrNull()?.path?.substringBeforeLast('.') ?: "Imported project" else "Imported project")
    }

    private fun guarded(block: () -> DeckProject): DeckProject = try { block() } catch (error: Throwable) {
        staging.deleteRecursively()
        throw if (error is java.io.IOException && error.message?.contains("ENOSPC") == true) IllegalStateException("There is not enough free storage on this device for this project.") else error
    }

    private fun finish(name: String): DeckProject {
        require(written.isNotEmpty()) { "No usable files were found in this project." }
        // Drop a single wrapping folder so "site/index.html" becomes "index.html".
        val first = written.first().path.substringBefore('/')
        val wrapped = written.all { it.path.startsWith("$first/") }
        val source = if (wrapped) File(staging, first) else staging
        val files = written.map { if (wrapped) it.copy(path = it.path.removePrefix("$first/")) else it }.sortedBy { it.path }
        val target = File(root, id)
        check(source.renameTo(target)) { "Could not save the imported project." }
        staging.deleteRecursively()
        // Keep storage tidy: only the most recent import is kept on disk.
        root.listFiles()?.filter { it.name != id }?.forEach { it.deleteRecursively() }
        val (framework, entry) = detect(target, files.map { it.path }.toSet())
        return DeckProject(id, name, framework, entry, files, files.sumOf { it.size }, System.currentTimeMillis())
    }

    private fun detect(dir: File, paths: Set<String>): Pair<String, String> {
        val pkg = try { JSONObject(File(dir, "package.json").takeIf { it.isFile }?.readText() ?: "{}") } catch (_: Exception) { JSONObject() }
        val deps = (pkg.optJSONObject("dependencies")?.keys()?.asSequence()?.toSet() ?: emptySet()) + (pkg.optJSONObject("devDependencies")?.keys()?.asSequence()?.toSet() ?: emptySet())
        val built = builtDirs.map { "$it/index.html" }.firstOrNull { it in paths }
        if (built != null && unsupportedSources.any { it in deps }) return "HTML" to built
        val next = listOf("app/page.tsx", "app/page.jsx", "app/page.js", "src/app/page.tsx", "src/app/page.jsx", "pages/index.tsx", "pages/index.jsx", "pages/index.js").firstOrNull { it in paths }
        if (next != null) return "Next.js" to next
        if ("next" in deps && built != null) return "HTML" to built
        val react = listOf("src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.js", "main.tsx", "main.jsx", "index.tsx", "index.jsx").firstOrNull { it in paths }
        if ("index.html" in paths) return (if ("react" in deps || react != null) "React" else "HTML") to "index.html"
        if (react != null && ("react" in deps || react.endsWith("x"))) return "React" to react
        if (built != null) return "HTML" to built
        val sorted = paths.sortedWith(compareBy({ it.count { c -> c == '/' } }, { it }))
        sorted.firstOrNull { it.endsWith("index.html", true) }?.let { return "HTML" to it }
        sorted.firstOrNull { it.endsWith(".html", true) || it.endsWith(".htm", true) }?.let { return "HTML" to it }
        sorted.firstOrNull { Regex("\\.(m?[jt]sx?)$").containsMatchIn(it) }?.let { return "JavaScript" to it }
        error("No web page or script was found in this project.")
    }
}
