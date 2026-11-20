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

/** Write-this-formula prompts, in levels that build up from single symbols to full formulas.
 *  glyphs: the symbols you write, roughly left to right (fraction bars and root signs aren't symbols). */
data class FPrompt(val src: String, val glyphs: List<String>, val level: Int)
private fun g(vararg t: String) = t.toList()
val LEVELS = listOf("Single symbols", "Small terms", "Short expressions", "Equations", "Fractions, roots and integrals")
val FORMULA_PROMPTS = listOf(
    FPrompt("x", g("x"), 1), FPrompt("y", g("y"), 1), FPrompt("2", g("2"), 1), FPrompt("+", g("+"), 1), FPrompt("=", g("="), 1),
    FPrompt("theta", g("theta"), 1), FPrompt("pi", g("pi"), 1), FPrompt("alpha", g("alpha"), 1), FPrompt("lambda", g("lambda"), 1), FPrompt("oo", g("oo"), 1),
    FPrompt("2x", g("2", "x"), 2), FPrompt("3y", g("3", "y"), 2), FPrompt("x^2", g("x", "2"), 2), FPrompt("a_1", g("a", "1"), 2),
    FPrompt("pi r", g("pi", "r"), 2), FPrompt("dx", g("d", "x"), 2), FPrompt("e^x", g("e", "x"), 2), FPrompt("10^6", g("1", "0", "6"), 2),
    FPrompt("2x + 3y", g("2", "x", "+", "3", "y"), 3), FPrompt("x^2 + 1", g("x", "2", "+", "1"), 3), FPrompt("a_1 + a_2", g("a", "1", "+", "a", "2"), 3),
    FPrompt("x - y", g("x", "-", "y"), 3), FPrompt("2 pi f", g("2", "pi", "f"), 3), FPrompt("x <= 5", g("x", "<=", "5"), 3), FPrompt("n_(p0) - J_s", g("n", "p", "0", "-", "J", "s"), 3),
    FPrompt("x^2 + y^2 = r^2", g("x", "2", "+", "y", "2", "=", "r", "2"), 4), FPrompt("E = mc^2", g("E", "=", "m", "c", "2"), 4),
    FPrompt("F = ma", g("F", "=", "m", "a"), 4), FPrompt("y = mx + b", g("y", "=", "m", "x", "+", "b"), 4),
    FPrompt("alpha + beta = gamma", g("alpha", "+", "beta", "=", "gamma"), 4), FPrompt("omega = 2 pi f", g("omega", "=", "2", "pi", "f"), 4),
    FPrompt("lambda nu = c", g("lambda", "nu", "=", "c"), 4), FPrompt("P = sigma A T^4", g("P", "=", "sigma", "A", "T", "4"), 4),
    FPrompt("f(x) = e^(-x)", g("f", "(", "x", ")", "=", "e", "-", "x"), 4), FPrompt("theta = phi + psi", g("theta", "=", "phi", "+", "psi"), 4),
    FPrompt("Delta n = 1.2 xx 10^(-5)", g("Delta", "n", "=", "1", ".", "2", "xx", "1", "0", "-", "5"), 4),
    FPrompt("(a + b)/(c - d)", g("a", "+", "b", "c", "-", "d"), 5), FPrompt("1/2", g("1", "2"), 5), FPrompt("sqrt(2) + 1", g("2", "+", "1"), 5),
    FPrompt("int_0^1 x dx", g("int", "0", "1", "x", "d", "x"), 5), FPrompt("sum_(n=1)^N 1/n^2", g("sum", "n", "=", "1", "N", "1", "n", "2"), 5),
    FPrompt("(dn)/(dT) = 1.2 xx 10^(-5)", g("d", "n", "d", "T", "=", "1", ".", "2", "xx", "1", "0", "-", "5"), 5),
    FPrompt("n_(p0) - J_s + (2 pi)/(k_b T)", g("n", "p", "0", "-", "J", "s", "+", "2", "pi", "k", "b", "T"), 5),
)

/** Compare the symbols that were read with the ones that should have been written.
 *  Returns (misread symbols turned into training samples, symbols read correctly). */
fun MainActivity.learnFromFormula(strokes: JSONArray, syms: List<Sym>, glyphs: List<String>): Pair<List<String>, List<String>> {
    val byToken = (Core.utilRaw("trainCount", "null") as? JSONArray)?.let { a -> (0 until a.length()).associate { a.getJSONArray(it).let { r -> r.optString(2) to r.getString(0) } } } ?: emptyMap()
    val remaining = glyphs.toMutableList()
    val unmatched = ArrayList<Sym>()
    val right = ArrayList<String>()
    for (sy in syms.sortedBy { it.x0 }) { if (remaining.remove(sy.ch)) right.add(sy.ch) else unmatched.add(sy) }
    val learned = ArrayList<String>()
    // only learn when the leftovers pair up one-to-one (otherwise we can't tell which symbol was which)
    if (unmatched.isNotEmpty() && unmatched.size == remaining.size && remaining.size <= maxOf(2, (glyphs.size * 0.4).toInt())) {
        unmatched.forEachIndexed { i, sy ->
            val shown = byToken[remaining[i]] ?: remaining[i]
            val sub = JSONArray(); sy.strokes.forEach { k -> strokes.optJSONObject(k)?.let { sub.put(it) } }
            if (sub.length() > 0) { Core.util("trainAdd", jo("sym" to shown, "strokes" to sub)); learned.add("$shown (read as ${sy.ch})") }
            // remember the mix-up: next time your samples may correct it
            Core.util("confusionAdd", jo("read" to sy.ch, "truth" to remaining[i]))
        }
        (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
        (Core.utilRaw("confusionsSave", "null") as? JSONObject)?.let { store.set("confusions", it.toString()) }
    }
    // symbols read correctly count toward "reliable" on the Symbols tab
    if (right.isNotEmpty()) {
        val o = try { JSONObject(store.pref("trainPasses", "{}")) } catch (e: Exception) { JSONObject() }
        right.mapNotNull { byToken[it] }.forEach { sym -> o.put(sym, o.optInt(sym) + 1) }
        store.set("trainPasses", o.toString())
    }
    return learned to right
}

private fun norm(s: String): String {
    var t = s.replace(Regex("\\s+"), "")
    val single = Regex("\\(([^()+\\-=*/,]+)\\)")
    while (true) { val n = single.replace(t, "$1"); if (n == t) break; t = n }
    return t
}
private fun words(s: String) = s.split(Regex("\\s+")).map { it.trim { c -> !c.isLetterOrDigit() } }.filter { it.isNotEmpty() }

/* ---------------- letters from copied words ---------------- */

private val LETTERISH = Regex("[A-Za-z0-9.,!?()=+'-]")

/** Split copied writing into words (big gaps) and letters (strokes that overlap side by side). When the counts match
 *  the sentence, each letter's strokes become a sample of that letter. Joined-up (cursive) words are skipped. */
fun MainActivity.learnLettersFromText(strokes: JSONArray, target: String): Pair<Int, Int> {
    data class B(val i: Int, val x0: Float, val y0: Float, val x1: Float, val y1: Float)
    val boxes = (0 until strokes.length()).mapNotNull { i ->
        val p = strokes.getJSONObject(i).optJSONArray("p") ?: return@mapNotNull null
        if (p.length() == 0) return@mapNotNull null
        var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y1 = -Float.MAX_VALUE
        for (k in 0 until p.length()) { val q = p.getJSONArray(k); val x = q.getDouble(0).toFloat(); val y = q.getDouble(1).toFloat()
            x0 = minOf(x0, x); y0 = minOf(y0, y); x1 = maxOf(x1, x); y1 = maxOf(y1, y) }
        B(i, x0, y0, x1, y1)
    }.sortedBy { it.x0 }
    if (boxes.isEmpty()) return 0 to 0
    val hs = boxes.map { it.y1 - it.y0 }.filter { it > 4f }.sorted()
    val h = if (hs.isEmpty()) 30f else hs[hs.size / 2]
    // letters: strokes overlapping horizontally (i + dot, t + cross, = …)
    val letters = ArrayList<MutableList<B>>()
    for (b in boxes) {
        val last = letters.lastOrNull()
        val right = last?.maxOf { it.x1 } ?: -1e9f
        val left = last?.minOf { it.x0 } ?: 0f
        val ov = right - b.x0
        if (last != null && ov > 0.3f * minOf(b.x1 - b.x0, right - left).coerceAtLeast(1f)) last.add(b) else letters.add(mutableListOf(b))
    }
    // words: the larger gaps between letters
    val words = ArrayList<MutableList<MutableList<B>>>()
    var prevRight = -1e9f
    for (l in letters) {
        val x0 = l.minOf { it.x0 }
        if (words.isEmpty() || x0 - prevRight > 0.55f * h) words.add(mutableListOf(l)) else words.last().add(l)
        prevRight = maxOf(prevRight, l.maxOf { it.x1 })
    }
    val want = target.split(Regex("\\s+")).filter { it.isNotEmpty() }.map { w -> w.filter { LETTERISH.matches(it.toString()) } }
    if (words.size != want.size) return 0 to want.size
    var learned = 0; var usable = 0
    val shownBy = SYM_GROUPS.flatMap { it.second }.toSet()
    for ((wi, w) in words.withIndex()) {
        val chars = want[wi]
        if (w.size != chars.length) continue            // joined letters or a stray mark: skip this word
        usable++
        w.forEachIndexed { li, l ->
            val ch = chars[li].toString().let { if (it == "-") "−" else it }
            if (ch !in shownBy) return@forEachIndexed
            val sub = JSONArray(); l.sortedBy { it.i }.forEach { sub.put(strokes.getJSONObject(it.i)) }
            Core.util("trainAdd", jo("sym" to ch, "strokes" to sub)); learned++
        }
    }
    if (learned > 0) (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
    return learned to usable
}

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
    var tab by remember { mutableStateOf(trainTab) }
    Dialog(onDismissRequest = { training = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.95f), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Teach InkNotes your handwriting", fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { exportTraining() }) { Text("Export training data") }
                    TextButton(onClick = { importTraining() }) { Text("Import training set") }
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
    // a symbol you picked yourself stays selected while you add samples
    var picked by remember { mutableStateOf(false) }
    val pad = remember { TrainPad(this).also { p -> p.onChange = { empty = p.empty } } }
    fun state(s: String): Int { val n = syms[s]?.count ?: 0; return when { n == 0 -> 0; n < 3 || (passes[s] ?: 0) < 1 -> 1; else -> 2 } }
    fun nextIn(g: Int) = SYM_GROUPS[g].second.firstOrNull { state(it) < 2 && it != cur } ?: SYM_GROUPS[g].second.first()

    Column(Modifier.fillMaxSize()) {
        Help(store, "symbols") {
        Text("Write the symbol shown at your normal size. You can write it once, or several times in a row with a gap between " +
            "each (e.g. 5 5 5 5 5) — every copy is saved as its own sample. About 5 good samples per symbol is plenty; it keeps your 10 most recent. " +
            "Once a symbol has a couple of samples, each new one is tested first: when InkNotes recognises it correctly it counts toward green (reliable). " +
            "Yellow = learning, grey = not trained yet. Use the S Pen button to erase a stroke, or Undo. " +
            "These samples correct formula conversions when Google's recogniser misreads a symbol (θ read as 0, ∞ as a, + as t …). " +
            "Formula practice (tab 3) also adds samples here automatically when it misreads one of your symbols.", fontSize = 13.sp, color = Muted)
        }
        FlowRow(Modifier.padding(vertical = 8.dp)) {
            SYM_GROUPS.forEachIndexed { i, (name, list) ->
                val done = list.count { state(it) == 2 }
                FilterChip(group == i, { group = i; picked = false; cur = nextIn(i); pad.clear(); note = "" }, { Text("$name  $done/${list.size}") }, Modifier.padding(2.dp))
            }
        }
        FlowRow {
            SYM_GROUPS[group].second.forEach { s ->
                val st = state(s)
                Box(Modifier.padding(2.dp).size(44.dp).clip(RoundedCornerShape(8.dp))
                    .background(when (st) { 2 -> Color(0xFFDCFCE7); 1 -> Color(0xFFFEF3C7); else -> Color(0xFFF3F4F6) })
                    .border(if (s == cur) 2.dp else 0.dp, Accent, RoundedCornerShape(8.dp))
                    .clickable { cur = s; picked = true; pad.clear(); note = "" }, contentAlignment = Alignment.Center) { Text(s, fontSize = 20.sp) }
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
        AndroidView(factory = { pad }, modifier = Modifier.fillMaxWidth().weight(1f).heightIn(min = 120.dp).clipToBounds().border(1.dp, Color(0xFFD8D0BD)))
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { pad.clear() }) { Text("Clear") }
            TextButton(onClick = { pad.undo() }) { Text("Undo") }
            TextButton(onClick = { pad.clear(); note = ""; picked = false; cur = nextIn(group) }) { Text("Next symbol") }
            TextButton(onClick = { Core.util("trainClear", jo("sym" to cur)); (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                passes = passes - cur; store.set("trainPasses", JSONObject(passes).toString()); syms = load(); note = "Samples for $cur forgotten" }) { Text("Forget $cur") }
            Spacer(Modifier.weight(1f))
            Button(enabled = !empty, onClick = {
                val samples = pad.groups()
                var ok = 0; var tested = 0; val looked = ArrayList<String>()
                for (strokes in samples) {
                    // test before learning: does what's already learned recognise this one?
                    if ((syms[cur]?.count ?: 0) >= 2) {
                        tested++
                        val top = (Core.util("classify", jo("strokes" to strokes)) as? JSONArray)?.optJSONArray(0)?.optString(0)
                        if (top == cur) ok++ else if (top != null) looked.add(top)
                    }
                    Core.util("trainAdd", jo("sym" to cur, "strokes" to strokes))
                    store.logTraining(jo("kind" to "symbol", "expected" to cur, "strokes" to strokes))
                    syms = load()
                }
                if (ok > 0) { passes = passes + (cur to (passes[cur] ?: 0) + ok); store.set("trainPasses", JSONObject(passes).toString()) }
                (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                note = "Saved ${samples.size} sample${if (samples.size == 1) "" else "s"}" +
                    (if (tested > 0) " · recognised $ok of $tested" else "") +
                    (if (looked.isNotEmpty()) " · some looked like ${looked.distinct().joinToString(", ")} (saved, to tell them apart)" else "")
                pad.clear()
                if (!picked && state(cur) == 2) cur = nextIn(group)
            }) { Text("Save sample(s)") }
        }
    }
}

/** Copy-this-text / write-this-formula: read it back, compare with the prompt, learn from the differences. */
@Composable
fun MainActivity.Practice(math: Boolean) {
    var level by remember(math) { mutableStateOf((store.pref("formulaLevel", "1").toIntOrNull() ?: 1).coerceIn(1, LEVELS.size)) }
    val prompts = remember(math, level) { (if (math) FORMULA_PROMPTS.filter { it.level == level }.map { it.src } else TEXT_PROMPTS).shuffled().toMutableList() }
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
        // every formula at this level read correctly once: move up a level
        if (math && level < LEVELS.size && prompts.distinct().all { it in passed }) {
            level++; store.set("formulaLevel", level.toString()); idx = 0; passed = emptySet()
            toast("Level $level: ${LEVELS[level - 1]}")
        }
    }

    Column(Modifier.fillMaxSize()) {
        Help(store, if (math) "formulas" else "text") {
        Text(if (math) "Write the formula shown the way you would in your notes (fractions stacked, exponents raised), then Check. " +
                "It starts with single symbols and builds up level by level; once every formula in a level has been read correctly you move up. " +
                "Everything here feeds the Symbols tab: a misread symbol is saved there as a new sample of what it should have been, and " +
                "symbols read correctly count toward green. " +
                "Missed formulas come back later. Keep going until you're getting at least 9 of the last 10 right."
            else "Copy the sentence in your normal handwriting, then Check. InkNotes reads it back and compares it word by word. " +
                "This teaches whole words (a misread word is remembered and fixed in future conversions); it doesn't change the letter " +
                "samples — use the Symbols tab for single letters. " +
                "Words it gets wrong are remembered as corrections and fixed automatically in future conversions. " +
                "Missed sentences come back later. Keep going until at least 9 of the last 10 are right.", fontSize = 13.sp, color = Muted)
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
            LinearProgressIndicator({ if (recent.isEmpty()) 0f else right / minOf(10, recent.size).toFloat() }, Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(4.dp)),
                color = if (sure) Color(0xFF16A34A) else Accent)
            Text("  $right/${minOf(10, recent.size)} recent · ${passed.size}/${prompts.distinct().size} prompts done", fontSize = 13.sp)
        }
        if (math) Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Level ", fontSize = 13.sp)
            LEVELS.forEachIndexed { i, name ->
                FilterChip(level == i + 1, { level = i + 1; store.set("formulaLevel", level.toString()); idx = 0; passed = emptySet(); pad.clear(); result = null; learned = "" },
                    { Text("${i + 1} · $name", fontSize = 12.sp) }, Modifier.padding(end = 4.dp))
            }
        }
        if (sure) Text("✓ Reasonably sure: your ${if (math) "formulas" else "handwriting"} is being read accurately. You can stop, or keep practising.",
            color = Color(0xFF15803D), fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text(if (math) "Write this formula:" else "Copy this text:", fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
        Box(Modifier.fillMaxWidth().background(Color(0xFFF3EEE2), RoundedCornerShape(8.dp)).padding(10.dp)) {
            if (math) TexImage(target, 30f, Modifier.fillMaxWidth())
            else Text(target, fontSize = 22.sp)
        }
        AndroidView(factory = { pad }, modifier = Modifier.fillMaxWidth().weight(1f).heightIn(min = 120.dp).padding(top = 8.dp).clipToBounds().border(1.dp, Color(0xFFD8D0BD)))
        result?.let { (ok, read) ->
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(if (ok) Color(0xFFDCFCE7) else Color(0xFFFEE2E2), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                if (math) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (ok) "✓ Read correctly:  " else "✗ I read:  ", fontWeight = FontWeight.Bold)
                    TexImage(read, 22f, Modifier.weight(1f).heightIn(max = 70.dp))
                } else {
                    Text(if (ok) "✓ Read correctly" else "✗ Read differently", fontWeight = FontWeight.Bold)
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
            TextButton(onClick = { pad.undo() }) { Text("Undo") }
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
                        if (math) {
                            val fp = FORMULA_PROMPTS.firstOrNull { it.src == target }
                            val syms = pieces.flatMap { it.syms }
                            if (fp != null) {
                                val (got, _) = learnFromFormula(strokes, syms, fp.glyphs)
                                notes.addAll(got)
                                learned = when {
                                    got.isNotEmpty() -> "Added to your symbol samples: " + got.joinToString(", ")
                                    !ok -> "Couldn't tell which symbol was misread — try writing them a little further apart, or train it on the Symbols tab."
                                    else -> ""
                                }
                            }
                        } else if (!ok) {
                            val tw = words(target); val rw = words(read)
                            // only remember non-words ("carity" → "cavity"); a real word like "vet" must not be rewritten everywhere
                            val words = JSONArray(store.userWords.toList())
                            if (tw.size == rw.size) for (i in tw.indices) if (!tw[i].equals(rw[i], ignoreCase = true)) {
                                val bad = (Core.util("misspelt", jo("text" to rw[i], "words" to words)) as? JSONArray)?.length() ?: 0
                                if (bad > 0) { rememberCorrection(rw[i], tw[i].lowercase()); notes.add("“${rw[i]}” → “${tw[i]}”") }
                                else notes.add("“${rw[i]}” is a real word, so it isn't auto-corrected — write “${tw[i]}” a little more clearly")
                            }
                            learned = if (notes.isEmpty()) "Word count differed — leave a clear gap between words." else "Will correct: " + notes.joinToString(", ")
                        }
                        if (!math) {
                            val (n, usable) = learnLettersFromText(strokes, target)
                            if (n > 0) learned = (if (learned.isEmpty()) "" else "$learned · ") + "Learned $n letter sample${if (n == 1) "" else "s"} from $usable word${if (usable == 1) "" else "s"}"
                            else if (learned.isEmpty() && !ok) learned = "Couldn't split the words into letters — leave a little space between letters and a bigger one between words."
                        }
                        store.logTraining(jo("kind" to (if (math) "formula" else "text"), "expected" to target, "read" to read, "ok" to ok,
                            "glyphs" to (FORMULA_PROMPTS.firstOrNull { it.src == target }?.glyphs?.let { JSONArray(it) }),
                            "syms" to JSONArray(pieces.flatMap { it.syms }.map { sy -> jo("ch" to sy.ch, "strokes" to JSONArray(sy.strokes)) }),
                            "pad" to jo("w" to pad.width, "h" to pad.height), "strokes" to strokes))
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

/** Instructions that fold away once read (remembered per tab). */
@Composable
fun Help(store: Store, key: String, content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(!store.pref("helpSeen:$key", false)) }
    if (open) {
        content()
        TextButton(onClick = { open = false; store.set("helpSeen:$key", true) }, contentPadding = PaddingValues(0.dp)) { Text("Hide instructions", fontSize = 13.sp) }
    } else TextButton(onClick = { open = true }, contentPadding = PaddingValues(0.dp)) { Text("How this works", fontSize = 13.sp) }
}
