package app.portdeck

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** Warm charcoal with one muted crimson accent; nothing is drawn at full white. Mirrors the web tokens. */
object Deck {
    val Background = Color(0xFF0E0C0D)
    val Background2 = Color(0xFF121011)
    val Surface = Color(0xFF161314)
    val Surface2 = Color(0xFF1C1819)
    val Surface3 = Color(0xFF252021)
    val Line = Color(0x12FFECEC)
    val Line2 = Color(0x1FFFECEC)
    val Line3 = Color(0x33FFECEC)
    val Text = Color(0xFFEBE5E5)
    val Text2 = Color(0xFFBDB4B5)
    val Muted = Color(0xFF958C8D)
    val Faint = Color(0xFF716869)
    val Accent = Color(0xFFE0444E)
    val AccentInk = Color(0xFFFF9CA2)
    val AccentSoft = Color(0x21E0444E)
    val Ok = Color(0xFF86BF98)
    val Warn = Color(0xFFD8B46E)
}

data class SegmentItem(val label: String, val icon: ImageVector? = null, val count: Int? = null)

/** Static crimson glow behind everything; drawn once, never animated. */
@Composable
fun AmbientBackground(modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize()) {
        drawRect(Deck.Background)
        val reach = maxOf(size.width, size.height)
        drawRect(Brush.radialGradient(listOf(Color(0x33A0202C), Color.Transparent), center = Offset(size.width * 0.92f, -size.height * 0.08f), radius = reach * 0.7f))
        drawRect(Brush.radialGradient(listOf(Color(0x1A781822), Color.Transparent), center = Offset(-size.width * 0.08f, size.height * 1.06f), radius = reach * 0.45f))
    }
}

private class Shard(var x: Float, var y: Float, val length: Float, val speed: Float, val width: Float, val alpha: Float, val accent: Boolean)

private const val SHARD_ANGLE = -0.6f
private val SHARD_COS = cos(SHARD_ANGLE)
private val SHARD_SIN = sin(SHARD_ANGLE)

/**
 * Faint drifting shards. Driven by the display's frame clock (so it runs at the panel's refresh rate),
 * invalidates drawing only, and stops completely while [active] is false.
 */
@Composable
fun ShardBackdrop(active: Boolean, modifier: Modifier = Modifier) {
    val shards = remember {
        List(26) { index ->
            Shard(
                x = Random.nextFloat(), y = Random.nextFloat(),
                length = 0.06f + Random.nextFloat() * 0.2f, speed = 0.006f + Random.nextFloat() * 0.016f,
                width = if (index % 9 == 0) 1.3f else 0.6f + Random.nextFloat() * 0.5f,
                alpha = 0.025f + Random.nextFloat() * 0.08f, accent = index % 9 == 0,
            )
        }
    }
    var frame by remember { mutableLongStateOf(0L) }
    LaunchedEffect(active) {
        if (!active) return@LaunchedEffect
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) {
                    val delta = ((now - last) / 1_000_000_000f).coerceAtMost(0.05f)
                    for (shard in shards) {
                        shard.x += SHARD_COS * shard.speed * delta
                        shard.y += SHARD_SIN * shard.speed * delta
                        if (shard.x > 1.15f || shard.y < -0.15f) {
                            if (Random.nextFloat() < 0.55f) { shard.x = Random.nextFloat(); shard.y = 1.05f + Random.nextFloat() * 0.1f }
                            else { shard.x = -0.05f - shard.length; shard.y = Random.nextFloat() }
                        }
                    }
                }
                last = now
                frame = now
            }
        }
    }
    Canvas(modifier.fillMaxSize()) {
        if (frame < 0L) return@Canvas
        val reach = maxOf(size.width, size.height)
        for (shard in shards) {
            val start = Offset(shard.x * size.width, shard.y * size.height)
            val end = Offset(start.x + SHARD_COS * shard.length * reach, start.y + SHARD_SIN * shard.length * reach)
            val color = if (shard.accent) Deck.Accent.copy(alpha = shard.alpha * 1.6f) else Color(0xFFFFF0F0).copy(alpha = shard.alpha)
            drawLine(color, start, end, strokeWidth = shard.width * density, cap = StrokeCap.Round)
        }
    }
}

/** The PortDeck mark: a bracketed slash. */
@Composable
fun Logo(size: Dp = 22.dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val unit = this.size.width / 24f
        val stroke = Stroke(width = 2.1f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val brackets = Path().apply {
            moveTo(8f * unit, 4.5f * unit); lineTo(5f * unit, 4.5f * unit); lineTo(5f * unit, 19.5f * unit); lineTo(8f * unit, 19.5f * unit)
            moveTo(16f * unit, 4.5f * unit); lineTo(19f * unit, 4.5f * unit); lineTo(19f * unit, 19.5f * unit); lineTo(16f * unit, 19.5f * unit)
        }
        drawPath(brackets, Deck.Text, style = stroke)
        drawLine(Deck.Accent, Offset(14f * unit, 6f * unit), Offset(10f * unit, 18f * unit), strokeWidth = 2.1f * unit, cap = StrokeCap.Round)
    }
}

/**
 * Shared press feedback: a fast spring down on touch, a softer overshoot on release, and a brief highlight.
 * Scaling happens in the graphics layer, so presses never trigger layout.
 */
@Composable
fun Pressable(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = RoundedCornerShape(12.dp),
    background: Color = Color.Transparent,
    border: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = if (pressed) spring(stiffness = Spring.StiffnessHigh) else spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow),
        label = "press",
    )
    val highlight by animateFloatAsState(if (pressed) 0.07f else 0f, tween(if (pressed) 60 else 380), label = "highlight")
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(background)
            .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier)
            .background(Color.White.copy(alpha = highlight))
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick),
        content = content,
    )
}

@Composable
fun DeckIconButton(icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Deck.Muted, size: Dp = 18.dp) {
    Pressable(modifier.size(40.dp), RoundedCornerShape(10.dp), onClick = onClick) {
        DeckIcon(icon, tint, Modifier.align(Alignment.Center), size)
    }
}

@Composable
fun PrimaryButton(label: String, icon: ImageVector?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Pressable(modifier.height(36.dp), RoundedCornerShape(10.dp), border = Color(0x14FFFFFF), onClick = onClick) {
        Row(
            Modifier.fillMaxHeight().background(Brush.verticalGradient(listOf(Color(0xFFE44D57), Color(0xFFC2333E)))).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) { DeckIcon(icon, Color.White, size = 16.dp); Spacer(Modifier.width(8.dp)) }
            Text(label, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun GhostButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Pressable(modifier.height(36.dp), RoundedCornerShape(10.dp), Color(0x08FFFFFF), Deck.Line2, onClick = onClick) {
        Text(label, color = Deck.Text2, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.align(Alignment.Center).padding(horizontal = 14.dp))
    }
}

/** Fades and lifts content in once, optionally staggered. Uses the graphics layer only. */
@Composable
fun Reveal(delayMillis: Int = 0, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(delayMillis.toLong())
        progress.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow))
    }
    Box(modifier.graphicsLayer { alpha = progress.value.coerceIn(0f, 1f); translationY = (1f - progress.value) * 14.dp.toPx() }) { content() }
}
