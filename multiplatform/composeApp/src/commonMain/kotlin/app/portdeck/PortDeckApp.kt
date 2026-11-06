package app.portdeck

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.snap
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.DpSize
import kotlinx.coroutines.launch
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

private data class Demo(val id: String, val name: String, val framework: String, val files: Int)
private data class ImportChoice(val kind: String, val title: String, val detail: String, val icon: ImageVector)

private val demos = listOf(
    Demo("demo-split", "Tip & Split", "React", 4),
    Demo("demo-notes", "Scratchpad", "HTML", 3),
    Demo("demo-timer", "Focus Timer", "Next.js", 3),
)

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun PortDeckApp(
    project: DeckProject?,
    projects: List<DeckProject>,
    error: String,
    logs: List<String>,
    onPick: (String) -> Unit,
    onDemo: (String) -> Unit,
    onOpenProject: (DeckProject) -> Unit,
    onDeleteProject: (DeckProject) -> Unit,
    onBack: () -> Unit,
    onReload: () -> Unit,
    onImmersive: (Boolean) -> Unit = {},
    readSource: (DeckFile, (String) -> Unit) -> Unit = { file, done -> done(file.content ?: "") },
    preview: @Composable (DeckProject, Int, Int, Boolean) -> Unit,
) {
    var dialog by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(if (projects.isEmpty()) "demos" else "projects") }
    Box(Modifier.fillMaxSize()) {
        AmbientBackground()
        ShardBackdrop(active = project == null)
        SharedTransitionLayout(Modifier.fillMaxSize()) {
            AnimatedContent(
                targetState = project,
                transitionSpec = { fadeIn(tween(260, delayMillis = 60)) togetherWith fadeOut(tween(180)) },
                contentKey = { it?.id ?: "library" },
                label = "screen",
            ) { current ->
                if (current == null) {
                    Library(projects, tab, { tab = it }, { dialog = "import" }, { dialog = "help" }, onDemo, onOpenProject, onDeleteProject, this@SharedTransitionLayout, this@AnimatedContent)
                } else {
                    ProjectScreen(current, logs, { tab = if (current.demo) "demos" else "projects"; onBack() }, onReload, onImmersive, readSource, preview, this@SharedTransitionLayout, this@AnimatedContent)
                }
            }
        }
    }
    if (dialog == "import") ImportDialog(onClose = { dialog = "" }, onPick = { kind -> dialog = ""; onPick(kind) })
    if (dialog == "help") HelpDialog(onClose = { dialog = "" })
    if (error.isNotEmpty()) AppDialog("Import failed", DeckIcons.CircleAlert, onBack) {
        Text(error, color = Deck.Text2, fontSize = 13.sp, lineHeight = 19.sp)
    }
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Deck.Line))
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun sharedProject(key: String, shared: SharedTransitionScope, visibility: AnimatedVisibilityScope): Modifier =
    with(shared) { Modifier.sharedBounds(rememberSharedContentState(key = key), animatedVisibilityScope = visibility) }

@Composable
fun Segment(items: List<SegmentItem>, selected: Int, compact: Boolean = false, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    BoxWithConstraints(modifier.height(36.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x47000000)).border(1.dp, Deck.Line, RoundedCornerShape(12.dp)).padding(3.dp)) {
        val segment = maxWidth / items.size
        val offset by animateDpAsState(segment * selected, spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow), label = "segment")
        Box(Modifier.offset(x = offset).width(segment).fillMaxHeight().clip(RoundedCornerShape(9.dp)).background(Deck.Surface3).border(1.dp, Deck.Line2, RoundedCornerShape(9.dp))) {
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).width(14.dp).height(2.dp).clip(RoundedCornerShape(1.dp)).background(Deck.Accent))
        }
        Row(Modifier.fillMaxSize()) {
            items.forEachIndexed { index, item ->
                val active = index == selected
                val color by animateColorAsState(if (active) Deck.Text else Deck.Muted, tween(220), label = "segmentLabel")
                Row(
                    Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(9.dp))
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onSelect(index) },
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    item.icon?.let { DeckIcon(it, color, size = 16.dp) }
                    if (!compact || item.icon == null) {
                        if (item.icon != null) Spacer(Modifier.width(7.dp))
                        Text(item.label, color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                    }
                    if (item.count != null) {
                        Spacer(Modifier.width(6.dp))
                        Text("${item.count}", color = Deck.Faint, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun AppDialog(title: String, icon: ImageVector?, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Reveal {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Deck.Surface).border(1.dp, Deck.Line2, RoundedCornerShape(18.dp))) {
                Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 16.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (icon != null) {
                        Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x0BFFFFFF)), contentAlignment = Alignment.Center) { DeckIcon(icon, Deck.Text2, size = 16.dp) }
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(title, color = Deck.Text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    DeckIconButton(DeckIcons.X, onClose)
                }
                Divider()
                Column(Modifier.padding(16.dp), content = content)
            }
        }
    }
}

@Composable
private fun IconTile(icon: ImageVector, size: Int = 36) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)).background(Color(0x0AFFFFFF)).border(1.dp, Deck.Line, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        DeckIcon(icon, Deck.Text2, size = 18.dp)
    }
}

@Composable
private fun ImportDialog(onClose: () -> Unit, onPick: (String) -> Unit) {
    val choices = listOf(
        ImportChoice("folder", "Folder", "A whole project directory", DeckIcons.Folder),
        ImportChoice("zip", "ZIP archive", "A compressed project", DeckIcons.FileArchive),
        ImportChoice("files", "Files", "One or more loose files", DeckIcons.Files),
    )
    AppDialog("Import project", DeckIcons.Upload, onClose) {
        Text("Files never leave this device.", color = Deck.Muted, fontSize = 12.5.sp, modifier = Modifier.padding(bottom = 12.dp))
        choices.forEachIndexed { index, choice ->
            Reveal(index * 50) {
                Pressable(Modifier.fillMaxWidth().padding(bottom = 6.dp), RoundedCornerShape(12.dp), Color(0x05FFFFFF), Deck.Line, onClick = { onPick(choice.kind) }) {
                    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconTile(choice.icon)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(choice.title, color = Deck.Text, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                            Text(choice.detail, color = Deck.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                        }
                        DeckIcon(DeckIcons.ChevronRight, Deck.Faint, size = 16.dp)
                    }
                }
            }
        }
        Text("Any size · node_modules and .git are skipped", color = Deck.Faint, fontSize = 11.5.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
    }
}

@Composable
private fun HelpDialog(onClose: () -> Unit) {
    val rows = listOf(
        Triple(DeckIcons.FolderInput, "Import", "Choose a folder, ZIP, or files. Projects stay on this device."),
        Triple(DeckIcons.MonitorSmartphone, "Preview", "Switch between fill, phone, and tablet, and turn phone or tablet between portrait and landscape. Console, files, and details open from the bottom bar."),
        Triple(DeckIcons.WifiOff, "Online and offline", "Projects of any size are stored on this device. React and Tailwind CSS are bundled; npm packages, CDN scripts, and fonts are saved the first time a project runs online."),
    )
    AppDialog("Guide", DeckIcons.CircleQuestionMark, onClose) {
        rows.forEachIndexed { index, (icon, title, body) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                IconTile(icon)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(title, color = Deck.Text, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    Text(body, color = Deck.Muted, fontSize = 12.5.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
            if (index < rows.lastIndex) Divider()
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun Library(
    projects: List<DeckProject>, tab: String, onTab: (String) -> Unit, onImport: () -> Unit, onHelp: () -> Unit,
    onDemo: (String) -> Unit, onOpenProject: (DeckProject) -> Unit, onDeleteProject: (DeckProject) -> Unit, shared: SharedTransitionScope, visibility: AnimatedVisibilityScope,
) {
    var menuFor by remember { mutableStateOf<DeckProject?>(null) }
    var deleteFor by remember { mutableStateOf<DeckProject?>(null) }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 10.dp)) {
            val compact = maxWidth < 440.dp
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Logo(22.dp, Modifier.padding(start = 4.dp))
                if (!compact) {
                    Spacer(Modifier.width(10.dp))
                    Text("PortDeck", color = Deck.Text, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp)
                }
                Spacer(Modifier.weight(1f))
                Segment(
                    items = listOf(
                        SegmentItem("Projects", count = if (compact) null else projects.size),
                        SegmentItem("Demos", count = if (compact) null else demos.size),
                    ),
                    selected = if (tab == "projects") 0 else 1,
                    modifier = Modifier.width(if (compact) 168.dp else 210.dp),
                ) { onTab(if (it == 0) "projects" else "demos") }
                Spacer(Modifier.weight(1f))
                DeckIconButton(DeckIcons.CircleQuestionMark, onHelp)
                Spacer(Modifier.width(4.dp))
                PrimaryButton("Import", DeckIcons.Upload, onImport)
            }
        }
        Divider()
        AnimatedContent(
            targetState = tab,
            transitionSpec = {
                val direction = if (targetState == "demos") 1 else -1
                (fadeIn(tween(220)) + slideInHorizontally(tween(320)) { it / 14 * direction }) togetherWith
                    (fadeOut(tween(140)) + slideOutHorizontally(tween(220)) { -it / 14 * direction })
            },
            label = "tab",
        ) { current ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 22.dp)) {
                Text(if (current == "projects") "Projects" else "Demos", color = Deck.Text, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)
                val subtitle = if (current == "demos") "Small apps to try the preview with" else if (projects.isEmpty()) "Nothing imported yet" else "Saved on this device"
                Text(subtitle, color = Deck.Muted, fontSize = 13.5.sp, modifier = Modifier.padding(top = 6.dp, bottom = 18.dp))
                if (current == "projects") {
                    if (projects.isEmpty()) EmptyState(onImport) { onTab("demos") }
                    else {
                        projects.forEachIndexed { index, saved ->
                            Reveal(index * 45) {
                                ProjectCard(
                                    saved.id, saved.name, "${saved.framework} · ${formatSize(saved.totalSize)}", saved.framework,
                                    shared, visibility,
                                    onClick = { onOpenProject(saved) },
                                    onLongPress = { menuFor = saved },
                                )
                            }
                        }
                        Text("Hold a project for more options.", color = Deck.Faint, fontSize = 11.5.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
                    }
                } else {
                    demos.forEachIndexed { index, demo ->
                        Reveal(index * 45) { ProjectCard(demo.id, demo.name, "${demo.framework} · ${demo.files} files", demo.framework, shared, visibility) { onDemo(demo.id) } }
                    }
                }
            }
        }
        ProjectMenuSheet(
            menuFor,
            { menuFor = null },
            { target -> menuFor = null; onOpenProject(target) },
            { target -> menuFor = null; deleteFor = target },
        )
        deleteFor?.let { target ->
            DeleteProjectDialog(target, { deleteFor = null }, { deleteFor = null; onDeleteProject(target) })
        }
    }
}

@Composable
private fun EmptyState(onImport: () -> Unit, onDemos: () -> Unit) {
    Reveal {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).border(1.dp, Deck.Line2, RoundedCornerShape(20.dp)).padding(vertical = 52.dp, horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Color(0x09FFFFFF)).border(1.dp, Deck.Line2, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                DeckIcon(DeckIcons.FolderOpen, Deck.Text2, size = 26.dp)
            }
            Text("No projects yet", color = Deck.Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp))
            Text("Import a project folder or ZIP to get started.", color = Deck.Muted, fontSize = 13.5.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp, bottom = 20.dp))
            Row {
                PrimaryButton("Import", DeckIcons.Upload, onImport)
                Spacer(Modifier.width(8.dp))
                GhostButton("Browse demos", onDemos)
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun ProjectCard(id: String, name: String, meta: String, framework: String, shared: SharedTransitionScope, visibility: AnimatedVisibilityScope, onClick: () -> Unit, onLongPress: (() -> Unit)? = null) {
    Pressable(Modifier.fillMaxWidth().padding(bottom = 8.dp).then(sharedProject("project-$id", shared, visibility)), RoundedCornerShape(16.dp), Deck.Surface, Deck.Line, onClick = onClick, onLongClick = onLongPress) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x0AFFFFFF)).border(1.dp, Deck.Line2, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                DeckIcon(brandFor(framework), Deck.Text2, size = 20.dp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(name, color = Deck.Text, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(meta, color = Deck.Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            }
            DeckIcon(DeckIcons.ArrowUpRight, Deck.Faint, size = 17.dp)
        }
    }
}

@Composable
private fun StatusPill(failed: Boolean, live: Boolean) {
    val label = if (failed) "Error" else if (live) "Live" else "Building"
    val tint by animateColorAsState(if (failed) Deck.AccentInk else if (live) Deck.Ok else Deck.Warn, tween(300), label = "status")
    Row(Modifier.clip(CircleShape).background(tint.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(tint))
        Spacer(Modifier.width(6.dp))
        Text(label, color = tint, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun LoadingScan() {
    val transition = rememberInfiniteTransition(label = "scan")
    val position by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "scanLine")
    Box(Modifier.fillMaxSize().background(Deck.Background2), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(76.dp)) {
            val edge = size.width
            val corner = 16.dp.toPx()
            val stroke = 2.dp.toPx()
            val color = Deck.Line3
            drawLine(color, Offset(0f, 0f), Offset(corner, 0f), stroke); drawLine(color, Offset(0f, 0f), Offset(0f, corner), stroke)
            drawLine(color, Offset(edge, 0f), Offset(edge - corner, 0f), stroke); drawLine(color, Offset(edge, 0f), Offset(edge, corner), stroke)
            drawLine(color, Offset(0f, edge), Offset(corner, edge), stroke); drawLine(color, Offset(0f, edge), Offset(0f, edge - corner), stroke)
            drawLine(color, Offset(edge, edge), Offset(edge - corner, edge), stroke); drawLine(color, Offset(edge, edge), Offset(edge, edge - corner), stroke)
            val inset = 8.dp.toPx()
            val y = inset + position * (edge - inset * 2)
            drawLine(Brush.horizontalGradient(listOf(Color.Transparent, Deck.Accent, Color.Transparent)), Offset(inset, y), Offset(edge - inset, y), stroke, cap = StrokeCap.Round)
        }
    }
}

private data class DeviceSpec(val label: String, val width: Int, val height: Int)
private val deviceSpecs = listOf(DeviceSpec("Fill", 0, 0), DeviceSpec("Phone", 390, 844), DeviceSpec("Tablet", 820, 1180))

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun ProjectScreen(
    project: DeckProject, logs: List<String>, onBack: () -> Unit, onReload: () -> Unit, onImmersive: (Boolean) -> Unit,
    readSource: (DeckFile, (String) -> Unit) -> Unit,
    preview: @Composable (DeckProject, Int, Int, Boolean) -> Unit, shared: SharedTransitionScope, visibility: AnimatedVisibilityScope,
) {
    var panel by remember(project.id) { mutableStateOf("") }
    var lastPanel by remember(project.id) { mutableStateOf("Console") }
    var device by remember(project.id) { mutableIntStateOf(0) }
    var landscape by remember(project.id) { mutableStateOf(false) }
    var immersive by remember(project.id) { mutableStateOf(false) }
    var source by remember { mutableStateOf<DeckFile?>(null) }
    var sourceText by remember { mutableStateOf<String?>(null) }
    // Turning the device: the frame snaps to its new shape while this carries it from the old rotation and scale.
    val turn = remember { Animatable(1f) }
    var turnFrom by remember { mutableStateOf(Triple(0f, 1f, 1f)) }
    val scope = rememberCoroutineScope()
    val settled = !visibility.transition.isRunning
    LaunchedEffect(immersive) { onImmersive(immersive) }
    DisposableEffect(Unit) { onDispose { onImmersive(false) } }
    LaunchedEffect(source) { sourceText = null; source?.let { file -> readSource(file) { text -> if (source == file) sourceText = text } } }
    val errorCount = logs.count { it.startsWith("ERROR") }
    val live = errorCount == 0 && logs.any { it.startsWith("Built") || it.startsWith("Preview") }
    val spec = deviceSpecs[device]
    val framed = spec.width > 0
    val cssWidth = if (framed && landscape) spec.height else spec.width
    val cssHeight = if (framed && landscape) spec.width else spec.height

    Column(Modifier.fillMaxSize().then(sharedProject("project-${project.id}", shared, visibility)).background(Deck.Background2).safeDrawingPadding()) {
        AnimatedVisibility(!immersive, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column {
                Row(Modifier.fillMaxWidth().height(52.dp).background(Deck.Background).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Pressable(shape = RoundedCornerShape(10.dp), onClick = onBack) {
                        Row(Modifier.height(40.dp).padding(start = 6.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            DeckIcon(DeckIcons.ChevronLeft, Deck.Muted, size = 19.dp)
                            Text(if (project.demo) "Demos" else "Projects", color = Deck.Muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                    Box(Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x0BFFFFFF)), contentAlignment = Alignment.Center) {
                        DeckIcon(brandFor(project.framework), Deck.Text2, size = 15.dp)
                    }
                    Spacer(Modifier.width(9.dp))
                    Text(project.name, color = Deck.Text, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(8.dp))
                    StatusPill(errorCount > 0, live)
                    Spacer(Modifier.weight(1f))
                    DeckIconButton(DeckIcons.RefreshCw, onReload)
                }
                Divider()
                BoxWithConstraints(Modifier.fillMaxWidth().height(48.dp).background(Deck.Background2).padding(horizontal = 10.dp)) {
                    val compact = maxWidth < 520.dp
                    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        Segment(
                            items = listOf(SegmentItem("Fill", DeckIcons.Scan), SegmentItem("Phone", DeckIcons.Smartphone), SegmentItem("Tablet", DeckIcons.Tablet)),
                            selected = device, compact = compact,
                            modifier = Modifier.width(if (compact) 150.dp else 300.dp),
                        ) { device = it }
                        AnimatedVisibility(
                            framed,
                            enter = expandHorizontally(spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
                            exit = shrinkHorizontally(spring(stiffness = Spring.StiffnessMedium)) + fadeOut(tween(120)),
                        ) {
                            Segment(
                                items = listOf(SegmentItem("Portrait", DeckIcons.RectangleVertical), SegmentItem("Landscape", DeckIcons.RectangleHorizontal)),
                                selected = if (landscape) 1 else 0, compact = true,
                                modifier = Modifier.padding(start = 8.dp).width(86.dp),
                            ) { index ->
                                val next = index == 1
                                if (next != landscape) {
                                    turnFrom = Triple(if (next) 90f else -90f, cssWidth.toFloat(), cssHeight.toFloat())
                                    landscape = next
                                    scope.launch { turn.snapTo(0f); turn.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMediumLow)) }
                                }
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        DeckIconButton(DeckIcons.Maximize2, { immersive = true })
                    }
                }
                Divider()
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).background(Color(0xFF0B0A0A)), contentAlignment = Alignment.Center) {
            val gutter = if (immersive) 16.dp else 24.dp
            val scale = if (framed) minOf((maxWidth - gutter).value / cssWidth, (maxHeight - gutter).value / cssHeight, 1f) else 1f
            val target = if (framed) DpSize((cssWidth * scale).dp, (cssHeight * scale).dp) else DpSize(maxWidth, maxHeight)
            val turning = turn.isRunning
            val width by animateDpAsState(target.width, if (turning) snap() else spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessLow), label = "frameWidth")
            val height by animateDpAsState(target.height, if (turning) snap() else spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessLow), label = "frameHeight")
            val shape = RoundedCornerShape(if (device == 1) 26.dp else if (framed) 16.dp else 0.dp)
            val (angle, oldW, oldH) = turnFrom
            // A full-size WebView must not sit inside a permanent clip/layer: Android can then
            // fail to composite it and the preview renders blank. Only wrap in a layer while turning.
            val turnModifier = if (turning) {
                Modifier.graphicsLayer {
                    val progress = turn.value
                    if (progress < 1f && cssWidth > 0) {
                        rotationZ = angle * (1f - progress)
                        scaleX = (oldH / cssWidth) + (1f - oldH / cssWidth) * progress
                        scaleY = (oldW / cssHeight) + (1f - oldW / cssHeight) * progress
                    }
                }
            } else Modifier
            val frameModifier = if (framed) Modifier.border(6.dp, Color(0xFF1A1617), shape).clip(shape) else Modifier
            Box(
                Modifier.size(width, height)
                    .then(turnModifier)
                    .then(frameModifier)
                    .background(Color(0xFF0B0A0A)),
            ) {
                if (settled) preview(project, cssWidth, cssHeight, !turning) else LoadingScan()
            }
            if (immersive) {
                Row(Modifier.align(Alignment.TopStart).padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xD1161213)).border(1.dp, Deck.Line2, RoundedCornerShape(14.dp)).padding(4.dp)) {
                    Segment(
                        items = listOf(SegmentItem("Fill", DeckIcons.Scan), SegmentItem("Phone", DeckIcons.Smartphone), SegmentItem("Tablet", DeckIcons.Tablet)),
                        selected = device, compact = true,
                        modifier = Modifier.width(148.dp),
                    ) { device = it }
                }
                Row(Modifier.align(Alignment.TopEnd).padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xD1161213)).border(1.dp, Deck.Line2, RoundedCornerShape(14.dp)).padding(4.dp)) {
                    if (framed) DeckIconButton(DeckIcons.RotateCw, {
                        turnFrom = Triple(if (!landscape) 90f else -90f, cssWidth.toFloat(), cssHeight.toFloat())
                        landscape = !landscape
                        scope.launch { turn.snapTo(0f); turn.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMediumLow)) }
                    }, tint = Deck.Text2)
                    DeckIconButton(DeckIcons.Minimize2, { immersive = false }, tint = Deck.Text2)
                }
            }
        }
        AnimatedVisibility(
            panel.isNotEmpty() && !immersive,
            enter = expandVertically(spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
            exit = shrinkVertically(tween(200)) + fadeOut(tween(140)),
        ) {
            Column {
                Divider()
                Box(Modifier.fillMaxWidth().height(200.dp).background(Deck.Background)) {
                    when (lastPanel) {
                        "Files" -> LazyColumn(Modifier.fillMaxSize().padding(4.dp)) {
                            items(project.files, key = { it.path }) { file ->
                                Pressable(Modifier.fillMaxWidth(), RoundedCornerShape(8.dp), onClick = { source = file }) {
                                    Row(Modifier.fillMaxWidth().height(36.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                        DeckIcon(fileIconFor(file.path), Deck.Faint, size = 16.dp)
                                        Spacer(Modifier.width(10.dp))
                                        Text(file.path, color = Deck.Text2, fontFamily = FontFamily.Monospace, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                        Text(formatSize(file.size), color = Deck.Faint, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                        "Info" -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                            InfoRow("Framework", project.framework)
                            InfoRow("Entry", project.entry)
                            InfoRow("Size", "${project.files.size} files · ${formatSize(project.totalSize.takeIf { it > 0 } ?: project.files.sumOf { it.size })}")
                            InfoRow("Offline", "React, Tailwind CSS, and npm packages after their first online run")
                        }
                        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                            (logs.ifEmpty { listOf("Building ${project.name}") }).takeLast(80).forEach { entry ->
                                val error = entry.startsWith("ERROR")
                                val warn = entry.startsWith("WARN") || entry.contains("network")
                                val ok = entry.startsWith("Built") || entry.startsWith("Preview")
                                val tint = if (error) Color(0xFFF2B0B4) else if (warn) Color(0xFFE3CC9C) else Deck.Text2
                                val icon = if (error) DeckIcons.CircleX else if (warn) DeckIcons.TriangleAlert else if (ok) DeckIcons.CircleCheck else DeckIcons.ChevronRight
                                val iconTint = if (error) Deck.AccentInk else if (warn) Deck.Warn else if (ok) Deck.Ok else Deck.Faint
                                Row(Modifier.fillMaxWidth().background(if (error) Color(0x0FE0444E) else Color.Transparent).padding(horizontal = 14.dp, vertical = 4.dp)) {
                                    DeckIcon(icon, iconTint, Modifier.padding(top = 2.dp), 14.dp)
                                    Spacer(Modifier.width(9.dp))
                                    Text(entry.removePrefix("WARN: ").removePrefix("ERROR: "), color = tint, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
        AnimatedVisibility(!immersive, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column {
                Divider()
                Row(Modifier.fillMaxWidth().height(50.dp).background(Deck.Background).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    listOf(Triple("Console", DeckIcons.SquareTerminal, errorCount), Triple("Files", DeckIcons.Files, 0), Triple("Info", DeckIcons.Info, 0)).forEach { (label, icon, badge) ->
                        val active = panel == label
                        val background by animateColorAsState(if (active) Color(0x0FFFFFFF) else Color.Transparent, tween(200), label = "tab")
                        Pressable(Modifier.padding(end = 2.dp), RoundedCornerShape(10.dp), background, onClick = { if (active) panel = "" else { lastPanel = label; panel = label } }) {
                            Row(Modifier.height(36.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                DeckIcon(icon, if (active) Deck.AccentInk else Deck.Muted, size = 16.dp)
                                Spacer(Modifier.width(7.dp))
                                Text(label, color = if (active) Deck.Text else Deck.Muted, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                                if (badge > 0) {
                                    Spacer(Modifier.width(6.dp))
                                    Box(Modifier.clip(CircleShape).background(Deck.Accent).padding(horizontal = 5.dp)) { Text("$badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    if (panel.isNotEmpty()) DeckIconButton(DeckIcons.ChevronDown, { panel = "" })
                }
            }
        }
    }
    source?.let { file ->
        AppDialog(file.path, fileIconFor(file.path), { source = null }) {
            val text = sourceText
            if (text == null) LoadingScan()
            else Text(
                text.ifEmpty { "This file cannot be shown as text (${file.type.ifEmpty { "binary" }}, ${formatSize(file.size)})." },
                color = Deck.Text2, fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 18.sp,
                modifier = Modifier.height(380.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()),
            )
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Column(Modifier.padding(bottom = 14.dp)) {
        Text(label, color = Deck.Faint, fontSize = 11.5.sp)
        Text(value, color = Deck.Text2, fontFamily = FontFamily.Monospace, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectMenuSheet(target: DeckProject?, onDismiss: () -> Unit, onOpen: (DeckProject) -> Unit, onDelete: (DeckProject) -> Unit) {
    if (target == null) return
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Deck.Surface,
        tonalElevation = 0.dp,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
        dragHandle = { Box(Modifier.padding(vertical = 10.dp).width(34.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Deck.Line2)) },
    ) {
        Column(Modifier.padding(horizontal = 14.dp).padding(bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(Color(0x0AFFFFFF)).border(1.dp, Deck.Line2, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    DeckIcon(brandFor(target.framework), Deck.Text2, size = 22.dp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(target.name, color = Deck.Text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(2.dp))
                    Text("${target.framework} · ${target.files.size} files · ${formatSize(target.totalSize)}", color = Deck.Muted, fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
            MenuAction(DeckIcons.ExternalLink, "Open project", null, destructive = false, onClick = { onOpen(target) })
            Spacer(Modifier.height(6.dp))
            MenuAction(DeckIcons.Trash2, "Delete project", Deck.AccentInk, destructive = true, onClick = { onDelete(target) })
        }
    }
}

@Composable
private fun MenuAction(icon: ImageVector, label: String, tint: Color?, destructive: Boolean, onClick: () -> Unit) {
    Pressable(
        Modifier.fillMaxWidth().height(52.dp),
        RoundedCornerShape(13.dp),
        if (destructive) Color(0x14E0444E) else Color(0x08FFFFFF),
        border = Deck.Line,
        onClick = onClick,
    ) {
        Row(Modifier.fillMaxHeight().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            DeckIcon(icon, tint ?: Deck.Text2, size = 19.dp)
            Spacer(Modifier.width(13.dp))
            Text(label, color = tint ?: Deck.Text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun DeleteProjectDialog(target: DeckProject, onCancel: () -> Unit, onConfirm: () -> Unit) {
    AppDialog("Delete project", DeckIcons.Trash2, onCancel) {
        Text("Delete “${target.name}” and its ${target.files.size} files (${formatSize(target.totalSize)}) from this device? This cannot be undone.", color = Deck.Text2, fontSize = 13.sp, lineHeight = 19.sp)
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            GhostButton("Cancel", onCancel)
            Spacer(Modifier.width(8.dp))
            PrimaryButton("Delete", DeckIcons.Trash2, onConfirm)
        }
    }
}
