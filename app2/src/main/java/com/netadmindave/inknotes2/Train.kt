package com.netadmindave.inknotes2

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/* ---------------- what to practise ---------------- */

/** symbol shown, AsciiMath token, samples saved */
data class TSym(val sym: String, val token: String, val count: Int)

val SYM_GROUPS = listOf(
    "Digits" to "0123456789".map { it.toString() },
    "Lowercase" to "abcdefghijklmnopqrstuvwxyz".map { it.toString() },
    "Capitals" to "ABCDEFGHIJKLMNOPQRSTUVWXYZ".map { it.toString() },
    "Greek" to listOf("α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω"),
    "Greek capitals" to listOf("Γ", "Δ", "Θ", "Λ", "Ξ", "Π", "Σ", "Φ", "Ψ", "Ω"),
    "Operators" to listOf("+", "−", "=", "×", "÷", "·", "/", "±", "<", ">", "≤", "≥", "≠", "≈", "∝", "(", ")", "[", "]", "{", "}", "|", "!", "′", ",", "%", "°"),
    "Calculus & more" to listOf("∫", "∮", "∑", "∏", "√", "∞", "∂", "∇", "→", "∈", "∀", "∃"),
)

/** Copy-this-text prompts (pangrams cover every letter; the rest is lab vocabulary). */
val TEXT_PROMPTS = listOf(
    "The quick brown fox jumps over the lazy dog.",
    "Pack my box with five dozen liquor jugs.",
    "Sphinx of black quartz, judge my vow.",
    "The refractive index changes with temperature.",
    "Measure the heterodyne beat note on the photodiode.",
    "Lock the laser to the reference cavity first.",
    "Frequency comb spacing sets the resolution.",
    "Check the phase noise at a 10 kHz offset.",
    "Dispersion and birefringence both matter here.",
    "Calibrate the thermistor before each run.",
    "Align the fiber, then record the spectrum.",
    "Jumping quickly, wizards vex the brave dozen.",
)

/** Write-this-formula prompts: AsciiMath answer, and the symbols left to right (null when stacked, e.g. fractions). */
data class FPrompt(val src: String, val glyphs: List<String>?)
val FORMULA_PROMPTS = listOf(
    FPrompt("x^2 + y^2 = r^2", listOf("x", "2", "+", "y", "2", "=", "r", "2")),
    FPrompt("E = mc^2", listOf("E", "=", "m", "c", "2")),
    FPrompt("F = ma", listOf("F", "=", "m", "a")),
    FPrompt("y = mx + b", listOf("y", "=", "m", "x", "+", "b")),
    FPrompt("a_1 + a_2 = 3b", listOf("a", "1", "+", "a", "2", "=", "3", "b")),
    FPrompt("alpha + beta = gamma", listOf("alpha", "+", "beta", "=", "gamma")),
    FPrompt("omega = 2 pi f", listOf("omega", "=", "2", "pi", "f")),
    FPrompt("lambda nu = c", listOf("lambda", "nu", "=", "c")),
    FPrompt("P = sigma A T^4", listOf("P", "=", "sigma", "A", "T", "4")),
    FPrompt("Delta n = 1.2 xx 10^(-5)", listOf("Delta", "n", "=", "1", ".", "2", "xx", "1", "0", "-", "5")),
    FPrompt("n_(p0) - J_s", listOf("n", "p", "0", "-", "J", "s")),
    FPrompt("f(x) = e^(-x)", listOf("f", "(", "x", ")", "=", "e", "-", "x")),
    FPrompt("x <= 5", listOf("x", "<=", "5")),
    FPrompt("theta = phi + psi", listOf("theta", "=", "phi", "+", "psi")),
    FPrompt("(a + b)/(c - d)", null),
    FPrompt("sqrt(2) + 1", null),
    FPrompt("int_0^1 x dx", null),
    FPrompt("sum_(n=1)^N 1/n^2", null),
    FPrompt("(dn)/(dT) = 1.2 xx 10^(-5)", null),
    FPrompt("n_(p0) - J_s + (2 pi)/(k_b T)", null),
)

private fun norm(s: String) = s.replace(Regex("\\s+"), "")
private fun words(s: String) = s.split(Regex("\\s+")).map { it.trim { c -> !c.isLetterOrDigit() } }.filter { it.isNotEmpty() }

/* ---------------- text corrections memory ---------------- */

fun MainActivity.corrections(): Map<String, String> = try {
    val o = JSONObject(store.pref("corrections", "{}")); o.keys().asSequence().associateWith { o.getString(it) }
} catch (e: Exception) { emptyMap() }

fun MainActivity.rememberCorrection(from: String, to: String) {
    val o = try { JSONObject(store.pref("corrections", "{}")) } catch (e: Exception) { JSONObject() }
    o.put(from.lowercase(), to); store.set("corrections", o.toString())
}

/** Replace words the recogniser keeps getting wrong for this writer. */
fun MainActivity.applyCorrections(t: String): String {
    val m = corrections(); if (m.isEmpty()) return t
    return Regex("[A-Za-z][A-Za-z']*").replace(t) { mr ->
        val fix = m[mr.value.lowercase()] ?: return@replace mr.value
        if (mr.value.first().isUpperCase()) fix.replaceFirstChar { it.uppercase() } else fix
    }
}

/* ---------------- the training screen ---------------- */

private val Muted = Color(0xFF6B6B6B)

@Composable
fun MainActivity.Trainer() {
    var tab by remember { mutableStateOf(0) }
    Dialog(onDismissRequest = { training = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.95f), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Teach InkNotes your handwriting", fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { training = false }) { Text("Close") }
                }
                TabRow(tab) {
                    Tab(tab == 0, { tab = 0 }, text = { Text("1 · Symbols") })
                    Tab(tab == 1, { tab = 1 }, text = { Text("2 · Copy this text") })
                    Tab(tab == 2, { tab = 2 }, text = { Text("3 · Write this formula") })
                }
                Box(Modifier.weight(1f).padding(top = 10.dp)) {
                    when (tab) { 0 -> SymbolTraining(); 1 -> Practice(false); else -> Practice(true) }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MainActivity.SymbolTraining() {
    fun load(): Map<String, TSym> = (Core.utilRaw("trainCount", "null") as? JSONArray)?.let { a ->
        (0 until a.length()).map { a.getJSONArray(it) }.associate { r -> r.getString(0) to TSym(r.getString(0), r.optString(2, r.getString(0)), r.getInt(1)) }
    } ?: emptyMap()
    var syms by remember { mutableStateOf(load()) }
    var passes by remember {
        val init: Map<String, Int> = try { JSONObject(store.pref("trainPasses", "{}")).let { o -> o.keys().asSequence().associateWith { k -> o.getInt(k) } } } catch (e: Exception) { emptyMap() }
        mutableStateOf(init)
    }
    var group by remember { mutableStateOf(0) }
    var cur by remember { mutableStateOf(SYM_GROUPS[0].second[0]) }
    var note by remember { mutableStateOf("") }
    var empty by remember { mutableStateOf(true) }
    val pad = remember { TrainPad(this).also { p -> p.onChange = { empty = p.empty } } }
    fun state(s: String): Int { val n = syms[s]?.count ?: 0; return when { n == 0 -> 0; n < 3 || (passes[s] ?: 0) < 1 -> 1; else -> 2 } }
    fun nextIn(g: Int) = SYM_GROUPS[g].second.firstOrNull { state(it) < 2 && it != cur } ?: SYM_GROUPS[g].second.first()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text("Write each symbol the way you normally do, then Save. After a few samples InkNotes tests each new one against what " +
            "it has learned: when it recognises your writing correctly the symbol turns green (reliable). Yellow = learning, grey = no samples yet. " +
            "Aim for 3–5 samples each, written at your normal size; vary them slightly like real writing. These samples correct formula " +
            "conversions when Google's recogniser misreads a symbol (θ read as 0, ∞ as a, + as t …).", fontSize = 13.sp, color = Muted)
        FlowRow(Modifier.padding(vertical = 8.dp)) {
            SYM_GROUPS.forEachIndexed { i, (name, list) ->
                val done = list.count { state(it) == 2 }
                FilterChip(group == i, { group = i; cur = nextIn(i); pad.clear(); note = "" }, { Text("$name  $done/${list.size}") }, Modifier.padding(2.dp))
            }
        }
        FlowRow {
            SYM_GROUPS[group].second.forEach { s ->
                val st = state(s)
                Box(Modifier.padding(2.dp).size(44.dp).clip(RoundedCornerShape(8.dp))
                    .background(when (st) { 2 -> Color(0xFFDCFCE7); 1 -> Color(0xFFFEF3C7); else -> Color(0xFFF3F4F6) })
                    .border(if (s == cur) 2.dp else 0.dp, Accent, RoundedCornerShape(8.dp))
                    .clickable { cur = s; pad.clear(); note = "" }, contentAlignment = Alignment.Center) { Text(s, fontSize = 20.sp) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
            Text(cur, fontSize = 64.sp, modifier = Modifier.width(110.dp))
            Column {
                Text("${syms[cur]?.count ?: 0} sample(s) · recognised correctly ${passes[cur] ?: 0}×", fontSize = 14.sp)
                Text(when (state(cur)) { 2 -> "Reliable — more samples still help if it's misread"; 1 -> "Learning — keep going"; else -> "Not trained yet" }, fontSize = 13.sp, color = Muted)
                if (note.isNotEmpty()) Text(note, fontSize = 13.sp, color = Accent)
            }
        }
        AndroidView(factory = { pad }, modifier = Modifier.fillMaxWidth().height(240.dp).clipToBounds().border(1.dp, Color(0xFFD8D0BD)))
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { pad.clear() }) { Text("Clear") }
            TextButton(onClick = { pad.clear(); note = ""; cur = nextIn(group) }) { Text("Skip") }
            TextButton(onClick = { Core.util("trainClear", jo("sym" to cur)); (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                passes = passes - cur; store.set("trainPasses", JSONObject(passes).toString()); syms = load(); note = "Samples for $cur forgotten" }) { Text("Forget $cur") }
            Spacer(Modifier.weight(1f))
            Button(enabled = !empty, onClick = {
                val strokes = pad.json()
                val have = syms[cur]?.count ?: 0
                // test before learning: does what's already learned recognise this one?
                if (have >= 2) {
                    val r = Core.util("classify", jo("strokes" to strokes)) as? JSONArray
                    val top = r?.optJSONArray(0)?.optString(0)
                    if (top == cur) { passes = passes + (cur to (passes[cur] ?: 0) + 1); store.set("trainPasses", JSONObject(passes).toString()); note = "✓ Recognised as $cur" }
                    else note = "Looked like ${top ?: "?"} — saved this sample to tell them apart"
                } else note = "Saved"
                Core.util("trainAdd", jo("sym" to cur, "strokes" to strokes))
                (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                syms = load(); pad.clear()
                if (state(cur) == 2) cur = nextIn(group)
            }) { Text("Save sample") }
        }
    }
}

/** Copy-this-text / write-this-formula: read it back, compare with the prompt, learn from the differences. */
@Composable
fun MainActivity.Practice(math: Boolean) {
    val prompts = remember(math) { (if (math) FORMULA_PROMPTS.map { it.src } else TEXT_PROMPTS).shuffled().toMutableList() }
    var idx by remember(math) { mutableStateOf(0) }
    var recent by remember(math) { mutableStateOf(listOf<Boolean>()) }
    var passed by remember(math) { mutableStateOf(setOf<String>()) }
    var result by remember(math) { mutableStateOf<Pair<Boolean, String>?>(null) }
    var learned by remember(math) { mutableStateOf("") }
    var busyHere by remember { mutableStateOf(false) }
    var empty by remember { mutableStateOf(true) }
    val pad = remember(math) { TrainPad(this).also { p -> p.onChange = { empty = p.empty } } }
    val target = prompts[idx % prompts.size]
    val right = recent.takeLast(10).count { it }
    val sure = recent.size >= 10 && right >= 9

    fun next(again: Boolean) {
        if (again) prompts.add(target)      // missed ones come back later
        idx++; pad.clear(); result = null; learned = ""
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(if (math) "Write the formula shown, the way you would in your notes (fractions stacked, exponents raised), then Check. " +
                "InkNotes reads it with the same engine used for conversion and compares it with the answer. When a symbol is misread, " +
                "your written version of it is saved as a training sample automatically, so the next conversion gets it right. " +
                "Missed formulas come back later. Keep going until you're getting at least 9 of the last 10 right."
            else "Copy the sentence in your normal handwriting, then Check. InkNotes reads it back and compares it word by word. " +
                "Words it gets wrong are remembered as corrections and fixed automatically in future conversions. " +
                "Missed sentences come back later. Keep going until at least 9 of the last 10 are right.", fontSize = 13.sp, color = Muted)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
            LinearProgressIndicator({ if (recent.isEmpty()) 0f else right / minOf(10, recent.size).toFloat() }, Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(4.dp)),
                color = if (sure) Color(0xFF16A34A) else Accent)
            Text("  $right/${minOf(10, recent.size)} recent · ${passed.size}/${prompts.distinct().size} prompts done", fontSize = 13.sp)
        }
        if (sure) Text("✓ Reasonably sure: your ${if (math) "formulas" else "handwriting"} is being read accurately. You can stop, or keep practising.",
            color = Color(0xFF15803D), fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text(if (math) "Write this formula:" else "Copy this text:", fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
        Box(Modifier.fillMaxWidth().background(Color(0xFFF3EEE2), RoundedCornerShape(8.dp)).padding(10.dp)) {
            if (math) AndroidView(factory = { c -> android.widget.ImageView(c) }, update = { iv -> iv.setImageDrawable(render.math(target, 64f)); iv.adjustViewBounds = true; iv.scaleType = android.widget.ImageView.ScaleType.FIT_START },
                modifier = Modifier.fillMaxWidth().heightIn(max = 140.dp))
            else Text(target, fontSize = 22.sp)
        }
        AndroidView(factory = { pad }, modifier = Modifier.fillMaxWidth().height(if (math) 300.dp else 260.dp).padding(top = 8.dp).clipToBounds().border(1.dp, Color(0xFFD8D0BD)))
        result?.let { (ok, read) ->
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(if (ok) Color(0xFFDCFCE7) else Color(0xFFFEE2E2), RoundedCornerShape(8.dp)).padding(10.dp)) {
                Text(if (ok) "✓ Read correctly" else "✗ Read differently", fontWeight = FontWeight.Bold)
                if (math) {
                    Text("I read:", fontSize = 13.sp)
                    AndroidView(factory = { c -> android.widget.ImageView(c) }, update = { iv -> iv.setImageDrawable(render.math(read, 56f)); iv.adjustViewBounds = true; iv.scaleType = android.widget.ImageView.ScaleType.FIT_START },
                        modifier = Modifier.fillMaxWidth().heightIn(max = 120.dp))
                    Text(read, fontSize = 12.sp, color = Muted)
                } else {
                    val tw = words(target); val rw = words(read)
                    Text(buildAnnotatedString {
                        append("I read: ")
                        rw.forEachIndexed { i, w -> if (tw.getOrNull(i)?.equals(w, ignoreCase = true) == true) append("$w ") else withStyle(SpanStyle(color = Color(0xFFB91C1C), fontWeight = FontWeight.Bold)) { append("$w ") } }
                    }, fontSize = 18.sp)
                }
                if (learned.isNotEmpty()) Text(learned, fontSize = 13.sp, color = Accent)
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { pad.clear(); result = null; learned = "" }) { Text("Clear") }
            TextButton(onClick = { next(result?.first == false) }) { Text(if (result == null) "Skip" else "Next") }
            Spacer(Modifier.weight(1f))
            if (busyHere) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            Button(enabled = !empty && !busyHere && result == null, onClick = {
                if (Recognizer.state != "ready") askModel = true else {
                busyHere = true
                val strokes = pad.json()
                lifecycleScope.launch {
                    try {
                        val pieces = Recognizer.convert(strokes, if (math) "math" else "text")
                        val read = if (math) pieces.joinToString(" ") { it.src } else applyCorrections(pieces.joinToString(" ") { it.src.replace('\n', ' ') })
                        val ok = if (math) norm(read) == norm(target) else words(read).map { it.lowercase() } == words(target).map { it.lowercase() }
                        val notes = ArrayList<String>()
                        if (!ok && math) {
                            val fp = FORMULA_PROMPTS.firstOrNull { it.src == target }
                            val syms = pieces.flatMap { it.syms }.sortedBy { it.x0 }
                            val glyphs = fp?.glyphs
                            if (glyphs != null && syms.size == glyphs.size) {
                                val byToken = (Core.utilRaw("trainCount", "null") as? JSONArray)?.let { a -> (0 until a.length()).associate { a.getJSONArray(it).let { r -> r.optString(2) to r.getString(0) } } } ?: emptyMap()
                                syms.forEachIndexed { i, sy ->
                                    if (sy.ch != glyphs[i]) {
                                        val shown = byToken[glyphs[i]] ?: glyphs[i]
                                        val sub = JSONArray(); sy.strokes.forEach { k -> strokes.optJSONObject(k)?.let { sub.put(it) } }
                                        Core.util("trainAdd", jo("sym" to shown, "strokes" to sub))
                                        notes.add("$shown (read as ${sy.ch})")
                                    }
                                }
                                (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                                learned = if (notes.isEmpty()) "" else "Learned from this: " + notes.joinToString(", ")
                            } else learned = if (glyphs == null) "Tip: if a symbol keeps being misread here, train it on the Symbols tab." else "Couldn't match symbols one-to-one — try writing them a little further apart."
                        } else if (!ok) {
                            val tw = words(target); val rw = words(read)
                            if (tw.size == rw.size) for (i in tw.indices) if (!tw[i].equals(rw[i], ignoreCase = true)) { rememberCorrection(rw[i], tw[i].lowercase()); notes.add("“${rw[i]}” → “${tw[i]}”") }
                            learned = if (notes.isEmpty()) "Word count differed — leave a clear gap between words." else "Will correct: " + notes.joinToString(", ")
                        }
                        recent = recent + ok
                        if (ok) passed = passed + target
                        result = ok to read
                    } catch (e: Exception) { toast(e.message ?: "Couldn't read that") }
                    busyHere = false
                }
                }
            }) { Text("Check") }
        }
    }
}
