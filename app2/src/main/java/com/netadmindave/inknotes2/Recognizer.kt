package com.netadmindave.inknotes2

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import com.google.mlkit.vision.digitalink.RecognitionContext
import com.google.mlkit.vision.digitalink.WritingArea
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

data class Sym(val strokes: List<Int>, val ch: String, val x0: Float)
/** tex: the formula model's reading (blank when it wasn't confident or isn't loaded); conf: its confidence */
data class Piece(val kind: String, val src: String, val alts: List<String>, val strokes: List<Int>, val syms: List<Sym> = emptyList(),
                 val tex: String = "", val modelTex: String = "", val conf: Float = 0f)

/** The trained ink → LaTeX formula model (assets/inkmath), run by the Rust engine. */
object FormulaModel {
    const val MIN_CONF = 0.4f
    @Volatile var ready = false
    @Volatile var error = ""

    /** Copies the model out of the APK once (the engine reads it from a file), then loads it. */
    fun load(ctx: android.content.Context) {
        if (ready) return
        try {
            val dir = java.io.File(ctx.filesDir, "inkmath").apply { mkdirs() }
            val stamp = ctx.packageManager.getPackageInfo(ctx.packageName, 0).lastUpdateTime.toString()
            val mark = java.io.File(dir, "installed")
            for (f in listOf("inkmath.onnx", "vocab.json")) {
                val out = java.io.File(dir, f)
                if (!out.exists() || !mark.exists() || mark.readText() != stamp) ctx.assets.open("inkmath/$f").use { i -> out.outputStream().use { i.copyTo(it) } }
            }
            mark.writeText(stamp)
            val r = Core.util("inkmathLoad", jo("onnx" to java.io.File(dir, "inkmath.onnx").path, "vocab" to java.io.File(dir, "vocab.json").path)) as? JSONObject
            ready = r?.optBoolean("ok") == true
            error = r?.optString("error") ?: "no engine"
        } catch (e: Exception) { error = e.message ?: e.toString() }
    }

    /** strokes: JSON stroke list. Returns (latex, confidence) or null. */
    fun read(strokes: JSONArray): Pair<String, Float>? {
        if (!ready) return null
        val r = Core.util("inkmath", jo("strokes" to strokes)) as? JSONObject ?: return null
        val t = r.optString("tex")
        return if (t.isBlank()) null else t to r.optDouble("conf", 0.0).toFloat()
    }

    /** Same formula? (compares canonical LaTeX tokens, so x^2 and x^{2} match) */
    fun same(a: String, b: String): Boolean = (Core.utilRaw("texCanon", a) as? String) == (Core.utilRaw("texCanon", b) as? String)
}

/** Google ML Kit reads characters; the Rust engine does layout (lines, fractions, scripts, limits) around it. */
object Recognizer {
    @Volatile var state = "checking" // checking | ready | missing | downloading | unavailable
    private var model: DigitalInkRecognitionModel? = null
    private var rec: DigitalInkRecognizer? = null

    suspend fun init() {
        try {
            val id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US") ?: run { state = "unavailable"; return }
            val m = DigitalInkRecognitionModel.builder(id).build()
            model = m
            if (RemoteModelManager.getInstance().isModelDownloaded(m).await()) make() else state = "missing"
        } catch (e: Throwable) { state = "unavailable" }
    }

    suspend fun download(): Boolean {
        val m = model ?: return false
        state = "downloading"
        return try {
            RemoteModelManager.getInstance().download(m, DownloadConditions.Builder().build()).await()
            make(); true
        } catch (e: Throwable) { state = "missing"; false }
    }

    private fun make() {
        if (rec == null) rec = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model!!).build())
        state = "ready"
    }

    private fun ink(strokes: JSONArray): Ink {
        val b = Ink.builder()
        var t = 1000L
        for (i in 0 until strokes.length()) {
            val pts = strokes.getJSONArray(i)
            val sb = Ink.Stroke.builder()
            var last = -1L
            for (j in 0 until pts.length()) {
                val q = pts.getJSONArray(j)
                val ts = if (q.length() > 2) q.optDouble(2, 0.0).toLong() else 0L
                var abs = t + if (ts > 0) ts else j * 8L
                if (abs <= last) abs = last + 1
                last = abs
                sb.addPoint(Ink.Point.create(q.getDouble(0).toFloat(), q.getDouble(1).toFloat(), abs))
            }
            b.addStroke(sb.build())
            t = last + 250
        }
        return b.build()
    }

    private suspend fun read(reqs: JSONArray): JSONArray = coroutineScope {
        val r = rec ?: throw IllegalStateException("Handwriting model not downloaded")
        val jobs = (0 until reqs.length()).map { i ->
            val q = reqs.getJSONObject(i)
            async {
                try {
                    val ctx = RecognitionContext.builder().setPreContext(q.optString("pre", ""))
                        .setWritingArea(WritingArea(q.optDouble("w", 100.0).toFloat().coerceAtLeast(1f), q.optDouble("h", 40.0).toFloat().coerceAtLeast(1f))).build()
                    r.recognize(ink(q.getJSONArray("strokes")), ctx).await().candidates.take(8).map { it.text }
                } catch (e: Exception) { emptyList() }
            }
        }
        JSONArray(jobs.awaitAll().map { JSONArray(it) })
    }

    /** strokes: JSON stroke list (as stored). mode: text | math | auto. */
    suspend fun convert(strokes: JSONArray, mode: String): List<Piece> {
        var st = Core.util("recoStart", jo("strokes" to strokes, "mode" to mode)) as? JSONObject ?: return emptyList()
        var guard = 0
        while (st.has("requests") && guard++ < 4) {
            val answers = read(st.getJSONArray("requests"))
            st = Core.utilRaw("recoFeed", answers.toString()) as? JSONObject ?: return emptyList()
        }
        val res = st.optJSONArray("result") ?: return emptyList()
        // piece stroke numbers count the strokes the engine read (highlighter and empty strokes left out)
        val used = (0 until strokes.length()).map { strokes.getJSONObject(it) }.filter { it.optString("k") != "hl" && (it.optJSONArray("p")?.length() ?: 0) > 0 }
        return (0 until res.length()).map { i ->
            val o = res.getJSONObject(i)
            val alts = o.optJSONArray("alts") ?: JSONArray()
            val ids = o.optJSONArray("strokes") ?: JSONArray()
            val sy = o.optJSONArray("syms") ?: JSONArray()
            val syms = (0 until sy.length()).map { k -> val q = sy.getJSONObject(k); val st = q.getJSONArray("strokes")
                Sym((0 until st.length()).map { st.getInt(it) }, q.optString("ch"), q.getJSONArray("b").getDouble(0).toFloat()) }
            val type = o.getString("type")
            val idl = (0 until ids.length()).map { ids.getInt(it) }
            var tex = ""; var modelTex = ""; var conf = 0f
            if (type == "math" && FormulaModel.ready) {
                val mine = JSONArray(); idl.forEach { k -> used.getOrNull(k)?.let { mine.put(it) } }
                FormulaModel.read(mine)?.let { (t, c) -> modelTex = t; conf = c; if (c >= FormulaModel.MIN_CONF) tex = t }
            }
            Piece(type, o.getString("src"), (0 until alts.length()).map { alts.getString(it) }, idl, syms, tex, modelTex, conf)
        }
    }
}
