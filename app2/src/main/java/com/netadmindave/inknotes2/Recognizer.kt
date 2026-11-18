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
data class Piece(val kind: String, val src: String, val alts: List<String>, val strokes: List<Int>, val syms: List<Sym> = emptyList())

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
        return (0 until res.length()).map { i ->
            val o = res.getJSONObject(i)
            val alts = o.optJSONArray("alts") ?: JSONArray()
            val ids = o.optJSONArray("strokes") ?: JSONArray()
            val sy = o.optJSONArray("syms") ?: JSONArray()
            val syms = (0 until sy.length()).map { k -> val q = sy.getJSONObject(k); val st = q.getJSONArray("strokes")
                Sym((0 until st.length()).map { st.getInt(it) }, q.optString("ch"), q.getJSONArray("b").getDouble(0).toFloat()) }
            Piece(o.getString("type"), o.getString("src"), (0 until alts.length()).map { alts.getString(it) }, (0 until ids.length()).map { ids.getInt(it) }, syms)
        }
    }
}
