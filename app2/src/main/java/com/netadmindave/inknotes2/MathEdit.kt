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
import androidx.compose.ui.graphics.asImageBitmap
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
            // AndroidView defaults to WRAP_CONTENT; a page sized to the viewport then collapses to nothing
            layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#FBF8F1"))
            webChromeClient = object : android.webkit.WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    android.util.Log.w("InkMath", "${m.messageLevel()} ${m.message()} @${m.sourceId()}:${m.lineNumber()}"); return true
                }
            }
            webViewClient = object : android.webkit.WebViewClient() {
                override fun onPageFinished(v: WebView, url: String) { android.util.Log.w("InkMath", "loaded $url ${v.width}x${v.height}") }
                override fun onReceivedError(v: WebView, r: android.webkit.WebResourceRequest, e: android.webkit.WebResourceError) { android.util.Log.w("InkMath", "error ${r.url} ${e.description}") }
            }
            settings.allowFileAccess = true
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

/** A formula drawn at its natural size (`sizeDp` = font size), shrunk only if it's wider than the space. */
@Composable
fun MainActivity.TexImage(src: String, sizeDp: Float, modifier: Modifier = Modifier) {
    val px = sizeDp * resources.displayMetrics.density
    val bm = androidx.compose.runtime.remember(src, px) {
        render.math(src, px)?.let { d ->
            val w = d.intrinsicWidth.coerceAtLeast(1); val h = d.intrinsicHeight.coerceAtLeast(1)
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            d.setBounds(0, 0, w, h); d.draw(Canvas(b)); b.asImageBitmap()
        }
    }
    if (bm == null) androidx.compose.material3.Text(src, modifier)
    else androidx.compose.foundation.Image(bm, null, modifier, contentScale = androidx.compose.ui.layout.ContentScale.Inside, alignment = androidx.compose.ui.Alignment.CenterStart)
}
