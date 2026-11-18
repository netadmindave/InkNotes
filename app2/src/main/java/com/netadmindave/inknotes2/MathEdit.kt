package com.netadmindave.inknotes2

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray
import org.json.JSONObject

/** Formulas edited in the 2-D editor are stored as LaTeX wrapped in \[ \] (older ones are AsciiMath). */
fun latexToSrc(tex: String) = if (tex.isBlank()) "" else "\\[$tex\\]"
fun srcToLatex(src: String) = if (src.isBlank()) "" else Core.tex(src)

/** LaTeX from MathLive → what the native renderer understands. */
fun tidyTex(t: String): String = t
    .replace("\\mleft", "\\left").replace("\\mright", "\\right")
    .replace(Regex("\\\\placeholder(\\[[^\\]]*\\])?\\{[^{}]*\\}"), "\\\\square ")
    .replace("\\exponentialE", "e").replace("\\imaginaryI", "i").replace("\\differentialD", "\\mathrm{d}")
    .replace("\\operatorname{", "\\mathrm{")
    .replace("\\lbrack", "[").replace("\\rbrack", "]")
    .replace("\\cdotp", "\\cdot")

/** MathLive (the same 2-D editor as CalcShelf) in a WebView: type the formula the way it looks. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MathField(initial: String, modifier: Modifier, onChange: (String) -> Unit) {
    val cb by rememberUpdatedState(onChange)
    AndroidView(factory = { ctx ->
        WebView(ctx).apply {
            setBackgroundColor(Color.parseColor("#FBF8F1"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(object {
                @JavascriptInterface fun input(s: String) { post { cb(s) } }
                @JavascriptInterface fun ready() { post { evaluateJavascript("setValue(${JSONObject.quote(initial)})", null) } }
            }, "Bridge")
            loadUrl("file:///android_asset/mathedit/index.html")
        }
    }, modifier = modifier)
}

/** Picture of some ink strokes (for checking a conversion against what was written). */
fun inkBitmap(strokes: JSONArray, maxW: Int = 640, maxH: Int = 260): Bitmap? {
    val g = Core.util("geom", jo("strokes" to strokes)) as? JSONArray ?: return null
    val ops = decodeGeom(FloatArray(g.length()) { g.getDouble(it).toFloat() })
    if (ops.isEmpty()) return null
    val b = android.graphics.RectF(ops[0].bounds)
    ops.forEach { b.union(it.bounds) }
    b.inset(-6f, -6f)
    val s = minOf(maxW / b.width(), maxH / b.height(), 2.5f)
    val bm = Bitmap.createBitmap((b.width() * s).toInt().coerceAtLeast(1), (b.height() * s).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val c = Canvas(bm)
    c.drawColor(PAPER)
    c.scale(s, s); c.translate(-b.left, -b.top)
    ops.forEach { c.drawPath(it.path, it.paint) }
    return bm
}
