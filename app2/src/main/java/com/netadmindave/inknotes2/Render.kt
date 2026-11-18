package com.netadmindave.inknotes2

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfRenderer
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.text.TextPaint
import android.util.LruCache
import androidx.core.content.res.ResourcesCompat
import org.json.JSONArray
import org.json.JSONObject
import ru.noties.jlatexmath.JLatexMathDrawable
import java.io.File
import java.util.concurrent.Executors

const val LINE = 32f
const val MARGIN_L = 96f
const val MARGIN_R = 56f
const val PAPER = 0xFFFBF8F1.toInt()
const val INK = 0xFF1D3557.toInt()

/** One stroke ready to paint. */
class StrokeOp(val path: Path, val paint: Paint, val rec: Int, val ms: Float, val bounds: RectF)

/** Decodes packed geometry from the engine into Paths. */
fun decodeGeom(g: FloatArray): List<StrokeOp> {
    val out = ArrayList<StrokeOp>()
    var i = 0
    while (i + 10 <= g.size) {
        val mode = g[i].toInt(); val n = g[i + 1].toInt()
        val rgb = g[i + 2].toLong().toInt(); val op = g[i + 3]; val w = g[i + 4]
        val dash = g[i + 5].toInt(); val closed = g[i + 6] > 0; val smooth = g[i + 7] > 0
        val rec = g[i + 8].toInt(); val ms = g[i + 9]
        i += 10
        if (i + n * 2 > g.size) break
        val path = Path()
        if (n > 0) {
            if (mode == 0) {
                // filled outline: midpoint quadratic curves through the outline points
                path.moveTo(g[i], g[i + 1])
                for (k in 1 until n) {
                    val x0 = g[i + 2 * k - 2]; val y0 = g[i + 2 * k - 1]; val x1 = g[i + 2 * k]; val y1 = g[i + 2 * k + 1]
                    path.quadTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
                }
                path.close()
            } else {
                path.moveTo(g[i], g[i + 1])
                if (smooth && n > 2) {
                    for (k in 1 until n - 1) {
                        val x0 = g[i + 2 * k]; val y0 = g[i + 2 * k + 1]; val x1 = g[i + 2 * k + 2]; val y1 = g[i + 2 * k + 3]
                        path.quadTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
                    }
                    path.lineTo(g[i + 2 * n - 2], g[i + 2 * n - 1])
                } else for (k in 1 until n) path.lineTo(g[i + 2 * k], g[i + 2 * k + 1])
                if (closed) path.close()
            }
        }
        i += n * 2
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = (0xFF shl 24) or (rgb and 0xFFFFFF)
        p.alpha = (op * 255).toInt().coerceIn(0, 255)
        if (mode == -1) { // lasso
            p.style = Paint.Style.STROKE; p.strokeWidth = 1.6f; p.color = 0xFF2563EB.toInt()
            p.pathEffect = DashPathEffect(floatArrayOf(6f, 5f), 0f)
        } else if (mode == 1) {
            p.style = Paint.Style.STROKE; p.strokeWidth = w; p.strokeCap = Paint.Cap.ROUND; p.strokeJoin = Paint.Join.ROUND
            when (dash) {
                1 -> p.pathEffect = DashPathEffect(floatArrayOf(w * 3.2f, w * 2.6f), 0f)
                2 -> { p.pathEffect = DashPathEffect(floatArrayOf(0.01f, w * 2.4f), 0f) }
            }
        } else p.style = Paint.Style.FILL
        val b = RectF(); path.computeBounds(b, true); b.inset(-w, -w)
        out.add(StrokeOp(path, p, rec, ms, b))
    }
    return out
}

/** Picture crop [l, t, r, b] as fractions (whole picture when absent). */
fun cropOf(it: JSONObject): FloatArray {
    val a = it.optJSONArray("crop") ?: return floatArrayOf(0f, 0f, 1f, 1f)
    val v = FloatArray(4) { k -> a.optDouble(k, if (k < 2) 0.0 else 1.0).toFloat() }
    return if (v[2] - v[0] < 0.01f || v[3] - v[1] < 0.01f) floatArrayOf(0f, 0f, 1f, 1f) else v
}

/** Shared drawing for screen and PDF export. */
class Renderer(val ctx: Context) {
    private val fonts = mapOf(
        "caveat" to (R.font.caveat to 31f), "kalam" to (R.font.kalam to 23f),
        "patrick" to (R.font.patrick_hand to 26f), "shadows" to (R.font.shadows to 26f))
    var font = "caveat"
    var textScale = 0.8f
    var autoMath = true
    var onAsyncReady: () -> Unit = {}

    val typeface: Typeface get() = ResourcesCompat.getFont(ctx, fonts[font]?.first ?: R.font.caveat) ?: Typeface.DEFAULT
    val textSize: Float get() = (fonts[font]?.second ?: 31f) * textScale

    private val rule = Paint().apply { color = 0xFFC9D8EA.toInt(); strokeWidth = 1f }
    private val margin = Paint().apply { color = 0xFFF0B8B8.toInt(); strokeWidth = 2f }
    private val grid = Paint().apply { color = 0xFFE2E9F1.toInt(); strokeWidth = 1f }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFC4CFDC.toInt() }
    private val paper = Paint().apply { color = PAPER }

    fun drawPaper(c: Canvas, w: Float, h: Float, kind: String, white: Boolean) {
        paper.color = if (white) Color.WHITE else PAPER
        c.drawRect(0f, 0f, w, h, paper)
        when (kind) {
            "lined" -> {
                var y = LINE - 0.5f
                while (y < h) { c.drawLine(0f, y, w, y, rule); y += LINE }
                c.drawLine(73f, 0f, 73f, h, margin)
            }
            "grid" -> {
                var x = 19.5f; while (x < w) { c.drawLine(x, 0f, x, h, grid); x += 20f }
                var y = 19.5f; while (y < h) { c.drawLine(0f, y, w, y, grid); y += 20f }
            }
            "dot" -> { var y = 1f; while (y < h) { var x = 1f; while (x < w) { c.drawCircle(x, y, 1.2f, dot); x += 24f }; y += 24f } }
        }
    }

    /* ---------- PDF pages ---------- */
    private val pdfExec = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val pdfCache = object : LruCache<String, Bitmap>(96 * 1024 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount }
    private val pending = HashSet<String>()
    private val renderers = HashMap<String, PdfRenderer>()

    fun pdfInfo(file: File): List<Pair<Float, Float>> = try {
        PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { r ->
            (0 until r.pageCount).map { i -> r.openPage(i).use { it.width.toFloat() to it.height.toFloat() } }
        }
    } catch (e: Exception) { emptyList() }

    private fun renderPdf(file: File, page: Int, wPx: Int): Bitmap? = synchronized(renderers) {
        try {
            val r = renderers.getOrPut(file.path) { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }
            r.openPage(page).use { p ->
                val hPx = (wPx.toFloat() * p.height / p.width).toInt().coerceAtLeast(1)
                val bm = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
                bm.eraseColor(Color.WHITE)
                p.render(bm, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bm
            }
        } catch (e: Exception) { null }
    }

    /** A PDF page as a bitmap `wPx` wide (blocking; call off the main thread). */
    fun pdfPage(file: File, page: Int, wPx: Int): Bitmap? = renderPdf(file, page, wPx)

    /** Draw a PDF page into (0,0,w,h). `px` is the wanted bitmap width; async on screen, sync for export. */
    fun drawPdf(c: Canvas, file: File, page: Int, w: Float, h: Float, px: Int, sync: Boolean) {
        val bucket = when { px <= 900 -> 900; px <= 1600 -> 1600; px <= 2600 -> 2600; else -> 3600 }
        val key = "${file.name}#$page@$bucket"
        var bm = pdfCache.get(key)
        if (bm == null && sync) bm = renderPdf(file, page, bucket)?.also { pdfCache.put(key, it) }
        if (bm == null) {
            // a lower resolution while the sharp one renders
            listOf(900, 1600, 2600, 3600).firstNotNullOfOrNull { pdfCache.get("${file.name}#$page@$it") }?.let { c.drawBitmap(it, null, RectF(0f, 0f, w, h), bmpPaint) }
            if (pending.add(key)) pdfExec.execute {
                val b = renderPdf(file, page, bucket)
                main.post { pending.remove(key); if (b != null) { pdfCache.put(key, b); onAsyncReady() } }
            }
            return
        }
        c.drawBitmap(bm, null, RectF(0f, 0f, w, h), bmpPaint)
    }
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)

    /* ---------- pictures ---------- */
    private val imgCache = object : LruCache<String, Bitmap>(64 * 1024 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount }
    fun image(file: File, maxPx: Int = 2048): Bitmap? {
        imgCache.get(file.path)?.let { return it }
        return try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, o)
            var s = 1
            while (o.outWidth / s > maxPx || o.outHeight / s > maxPx) s *= 2
            BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = s })?.also { imgCache.put(file.path, it) }
        } catch (e: Exception) { null }
    }

    /* ---------- math ---------- */
    private val mathCache = LruCache<String, JLatexMathDrawable>(300)
    fun math(src: String, size: Float, color: Int = INK): JLatexMathDrawable? {
        val key = "$size|$color|$src"
        mathCache.get(key)?.let { return it }
        return try {
            val tex = tidyTex(Core.tex(src))
            JLatexMathDrawable.builder(tex).textSize(size).color(color).padding(0).align(JLatexMathDrawable.ALIGN_LEFT).build()
                .also { mathCache.put(key, it) }
        } catch (e: Throwable) { null }
    }

    /* ---------- text with inline formulas ---------- */
    private class Run(val text: String?, val math: JLatexMathDrawable?, val w: Float, val h: Float, val space: Boolean)
    class Laid(val w: Float, val h: Float, val draw: (Canvas) -> Unit)

    val textPaint: TextPaint get() = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = this@Renderer.typeface; textSize = this@Renderer.textSize; color = INK }

    /** Lay out a text item: paragraphs, word wrap at `maxW`, `$…$` and auto-detected formulas drawn as math. */
    /** Typeface for a text style's font key, with bold/italic applied. */
    fun styledTypeface(st: JSONObject?): Typeface {
        val base = when (val f = st?.optString("font", "") ?: "") {
            "", "default" -> typeface
            "sans" -> Typeface.SANS_SERIF
            "serif" -> Typeface.SERIF
            "mono" -> Typeface.MONOSPACE
            else -> fonts[f]?.let { ResourcesCompat.getFont(ctx, it.first) } ?: typeface
        }
        val flags = (if (st?.optBoolean("bold") == true) Typeface.BOLD else 0) or (if (st?.optBoolean("italic") == true) Typeface.ITALIC else 0)
        return if (flags == 0) base else Typeface.create(base, flags)
    }

    fun layoutText(src: String, maxW: Float, color: Int = INK, misspelt: Set<String> = emptySet(), style: JSONObject? = null): Laid {
        val scaleF = (style?.optDouble("size", 1.0) ?: 1.0).toFloat().coerceIn(0.4f, 4f)
        val styleColor = style?.optString("color", "")?.takeIf { it.isNotEmpty() }?.let { try { Color.parseColor(it) } catch (e: Exception) { null } }
        val align = style?.optString("align", "") ?: ""
        val tp = textPaint.apply {
            this.color = styleColor ?: color
            textSize *= scaleF
            typeface = styledTypeface(style)
            isUnderlineText = style?.optBoolean("underline") == true
        }
        val fm = tp.fontMetrics
        val lineH = LINE.coerceAtLeast(fm.descent - fm.ascent)
        val draws = ArrayList<(Canvas) -> Unit>()
        var y = 0f
        var widest = 0f
        val wavy = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = 0xFFDC2626.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.2f }
        for (para in src.split('\n')) {
            val runs = ArrayList<Run>()
            // math spans: explicit $..$ first, then detected formulas
            val spans = ArrayList<IntRange>()
            Regex("\\$[^$]+\\$").findAll(para).forEach { spans.add(it.range) }
            if (autoMath) (Core.utilRaw("mathRuns", para) as? JSONArray)?.let { a ->
                for (k in 0 until a.length()) { val r = a.getJSONArray(k); val s = utf8ToIdx(para, r.getInt(0)); val e = utf8ToIdx(para, r.getInt(1)) - 1
                    if (spans.none { it.first <= e && s <= it.last }) spans.add(s..e) }
            }
            spans.sortBy { it.first }
            var p = 0
            fun words(t: String) {
                var first = true
                for (w in t.split(' ')) {
                    if (w.isEmpty()) { first = false; continue }
                    runs.add(Run(w, null, tp.measureText(w), lineH, !first || (t.startsWith(" ") && runs.isNotEmpty())))
                    first = false
                }
            }
            for (sp in spans) {
                if (sp.first > p) words(para.substring(p, sp.first))
                val raw = para.substring(sp.first, sp.last + 1).trim('$')
                val d = math(raw, tp.textSize * 0.82f, tp.color)
                val spaceBefore = sp.first > 0 && para[sp.first - 1] == ' '
                if (d != null) runs.add(Run(null, d, d.intrinsicWidth.toFloat(), d.intrinsicHeight.toFloat(), spaceBefore))
                else runs.add(Run(raw, null, tp.measureText(raw), lineH, spaceBefore))
                p = sp.last + 1
            }
            if (p < para.length) words(para.substring(p))
            // wrap
            val space = tp.measureText(" ")
            var line = ArrayList<Pair<Run, Float>>()
            var x = 0f
            fun flush() {
                val h = (line.maxOfOrNull { it.first.h } ?: lineH).coerceAtLeast(lineH)
                val rows = Math.ceil((h / LINE).toDouble()).toFloat().coerceAtLeast(1f) * LINE
                val base = y + rows - LINE * 0.28f
                val items = line.toList()
                val off = when (align) { "center" -> ((maxW - x) / 2f).coerceAtLeast(0f); "right" -> (maxW - x).coerceAtLeast(0f); else -> 0f }
                draws.add { c ->
                    for ((r, rx0) in items) {
                        val rx = rx0 + off
                        if (r.math != null) {
                            val mh = r.h
                            c.save(); c.translate(rx, base - mh + mh * 0.18f.coerceAtMost(0.3f) + (if (mh < LINE) (LINE * 0.18f) else 0f) - LINE * 0.08f)
                            r.math.setBounds(0, 0, r.w.toInt(), mh.toInt()); r.math.draw(c); c.restore()
                        } else if (r.text != null) {
                            c.drawText(r.text, rx, base, tp)
                            val bare = r.text.trim { !it.isLetter() && it != '\'' }
                            if (bare in misspelt) {
                                val pth = Path(); var wx = rx; pth.moveTo(wx, base + 4f)
                                while (wx < rx + r.w) { pth.quadTo(wx + 2f, base + 7f, wx + 4f, base + 4f); wx += 4f }
                                c.drawPath(pth, wavy)
                            }
                        }
                    }
                }
                widest = maxOf(widest, if (align == "center" || align == "right") maxW else x)
                y += rows
                line = ArrayList(); x = 0f
            }
            for (r in runs) {
                val gap = if (r.space && line.isNotEmpty()) space else 0f
                if (line.isNotEmpty() && x + gap + r.w > maxW) flush()
                val g2 = if (line.isEmpty()) 0f else gap
                line.add(r to x + g2); x += g2 + r.w
            }
            flush()
        }
        return Laid(widest, y) { c -> draws.forEach { it(c) } }
    }

    private fun utf8ToIdx(s: String, byteOff: Int): Int {
        var b = 0; var i = 0
        while (i < s.length && b < byteOff) { val cp = s.codePointAt(i); b += String(Character.toChars(cp)).toByteArray().size; i += Character.charCount(cp) }
        return i
    }

    /* ---------- items ---------- */
    class ItemBox(val id: String, val kind: String, val rect: RectF, val draw: (Canvas) -> Unit)

    fun layoutItem(it: JSONObject, pageW: Float, misspelt: Set<String> = emptySet()): ItemBox {
        val id = it.optString("id"); val kind = it.optString("type")
        val x = it.optDouble("x").toFloat(); val y = it.optDouble("y").toFloat()
        var w = it.optDouble("w", 0.0).toFloat(); val h0 = it.optDouble("h", 0.0).toFloat()
        val maxW = (if (w > 0) w else pageW - x - MARGIN_R).coerceAtLeast(60f)
        return when (kind) {
            "math" -> {
                val d = math(it.optString("src"), textSize * 0.9f)
                val dw = d?.intrinsicWidth?.toFloat() ?: 40f; val dh = d?.intrinsicHeight?.toFloat() ?: LINE
                val s = if (dw > maxW) maxW / dw else 1f
                ItemBox(id, kind, RectF(x, y, x + dw * s, y + dh * s)) { c -> if (d != null) { c.save(); c.translate(x, y); c.scale(s, s); d.setBounds(0, 0, dw.toInt(), dh.toInt()); d.draw(c); c.restore() } }
            }
            "image" -> {
                val f = File(File(ctx.filesDir, "media"), it.optString("file"))
                val bm = image(f)
                if (w <= 0) w = minOf(360f, pageW - x - MARGIN_R)
                val cr = cropOf(it)
                val h = if (bm != null) w * ((cr[3] - cr[1]) * bm.height) / ((cr[2] - cr[0]) * bm.width) else if (h0 > 0) h0 else w * 0.75f
                val src = if (bm != null) Rect((cr[0] * bm.width).toInt(), (cr[1] * bm.height).toInt(), (cr[2] * bm.width).toInt(), (cr[3] * bm.height).toInt()) else null
                ItemBox(id, kind, RectF(x, y, x + w, y + h)) { c -> if (bm != null) c.drawBitmap(bm, src, RectF(x, y, x + w, y + h), bmpPaint) else c.drawRect(x, y, x + w, y + h, grid) }
            }
            "table" -> {
                val cells = it.optJSONArray("cells") ?: JSONArray()
                val rows = cells.length(); val ncols = (0 until rows).maxOfOrNull { r -> cells.optJSONArray(r)?.length() ?: 0 } ?: 0
                val colsArr = it.optJSONArray("cols")
                val cw = (0 until ncols).map { k -> colsArr?.optDouble(k, 0.0)?.toFloat()?.takeIf { v -> v > 0 } ?: 120f }
                val laid = (0 until rows).map { r -> (0 until ncols).map { k -> layoutText(cells.optJSONArray(r)?.optString(k, "") ?: "", cw[k] - 12f) } }
                val rh = laid.map { row -> (row.maxOfOrNull { l -> l.h } ?: LINE).coerceAtLeast(LINE) + 8f }
                val tw = cw.sum(); val th = rh.sum()
                val gridP = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF8A94A6.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.2f }
                val head = Paint().apply { color = 0x14000000 }
                ItemBox(id, kind, RectF(x, y, x + tw, y + th)) { c ->
                    if (rows > 0) c.drawRect(x, y, x + tw, y + rh[0], head)
                    var yy = y
                    for (r in 0 until rows) {
                        var xx = x
                        for (k in 0 until ncols) { c.save(); c.translate(xx + 6f, yy + 2f); laid[r][k].draw(c); c.restore(); xx += cw[k] }
                        yy += rh[r]
                    }
                    c.drawRect(x, y, x + tw, y + th, gridP)
                    var xx = x; for (k in 0 until ncols - 1) { xx += cw[k]; c.drawLine(xx, y, xx, y + th, gridP) }
                    yy = y; for (r in 0 until rows - 1) { yy += rh[r]; c.drawLine(x, yy, x + tw, yy, gridP) }
                }
            }
            else -> {
                val l = layoutText(it.optString("src"), maxW, INK, misspelt, it.optJSONObject("style"))
                ItemBox(id, kind, RectF(x, y, x + maxOf(l.w, 24f), y + maxOf(l.h, LINE))) { c -> c.save(); c.translate(x, y); l.draw(c); c.restore() }
            }
        }
    }
}
