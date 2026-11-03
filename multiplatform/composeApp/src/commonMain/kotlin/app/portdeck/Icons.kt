package app.portdeck

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Builds a Lucide-style stroke icon from bundled path data (see IconData.kt). */
internal fun strokeIcon(name: String, pathData: String): ImageVector =
    ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(
            pathData = addPathNodes(pathData),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.75f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
        .build()

/** Builds a filled brand mark from bundled path data. */
internal fun fillIcon(name: String, pathData: String): ImageVector =
    ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(pathData = addPathNodes(pathData), fill = SolidColor(Color.Black))
        .build()

@Composable
fun DeckIcon(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, size: Dp = 18.dp) {
    Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = modifier.size(size))
}

fun brandFor(framework: String): ImageVector = when (framework) {
    "Next.js" -> BrandIcons.NextJs
    "React" -> BrandIcons.React
    "HTML" -> BrandIcons.Html5
    else -> BrandIcons.JavaScript
}

private val imageFile = Regex("\\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$", RegexOption.IGNORE_CASE)
private val codeFile = Regex("\\.(m?[jt]sx?|css|s[ac]ss|less|html?|vue|svelte)$", RegexOption.IGNORE_CASE)
private val textFile = Regex("\\.(md|mdx|txt)$", RegexOption.IGNORE_CASE)

fun fileIconFor(path: String): ImageVector = when {
    imageFile.containsMatchIn(path) -> DeckIcons.FileImage
    path.endsWith(".json", ignoreCase = true) -> DeckIcons.FileBraces
    codeFile.containsMatchIn(path) -> DeckIcons.FileCode
    textFile.containsMatchIn(path) -> DeckIcons.FileText
    path.endsWith(".zip", ignoreCase = true) -> DeckIcons.FileArchive
    else -> DeckIcons.File
}
