package com.netadmindave.inknotes2

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.widget.OverScroller
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Page layout, ink input (S Pen, finger, palm rejection), zoom/scroll and drawing for one open note. */
@SuppressLint("ViewConstructor")
class InkView(context: Context, val render: Renderer) : View(context) {
    private val GAP = 28f
    private val SIDE = 20f

    var h: Long = 0L
        private set
    private class PageState(var ver: Long = -1, var ops: List<StrokeOp> = emptyList(), var w: Float = 816f, var hgt: Float = 1056f,
                            var items: List<Renderer.ItemBox> = emptyList(), var bg: JSONObject? = null, var paper: String = "lined", var itemsJson: JSONArray = JSONArray())
    private val pages = ArrayList<PageState>()
    private val tops = ArrayList<Float>()
    private var contentW = 816f
    private var contentH = 1056f

    // settings
    var fingerDraws = false
    var lock = false
    var whitePaper = false
    var misspelt: Set<String> = emptySet()

    // callbacks
    var onChanged: () -> Unit = {}
    var onSelection: (Boolean) -> Unit = {}
    var onPlaceText: (Int, Float, Float) -> Unit = { _, _, _ -> }
    var onItemTap: (Int, String) -> Unit = { _, _ -> }
    var onSeek: (Int, Long) -> Unit = { _, _ -> }
    var onPageChanged: (Int) -> Unit = {}
    var recording: () -> Pair<Int, Long>? = { null }
    var toolKind: () -> String = { "pen" }
    var eraserRadius: () -> Float = { 10f }

    // playback (strokes written later than this point in the recording are faded)
    var playRec = -1
    var playMs = 0f
        set(v) { field = v; invalidate() }

    // view transform: screen = off + page * scale
    private var zoom = 1f
    private var scale = 1f
    private var offX = 0f
    private var offY = 0f

    fun open(handle: Long) {
        h = handle
        pages.clear()
        zoom = 1f; offY = 0f
        sync(true)
        layoutPages()
        offY = 12f
        invalidate()
    }
    fun close() { h = 0L; pages.clear() }

    /** Re-read pages whose version changed. */
    fun sync(force: Boolean = false) {
        if (h == 0L) return
        val meta = Core.call(h, "meta") as? JSONObject ?: return
        val n = meta.optInt("pages")
        var relayout = pages.size != n
        while (pages.size < n) pages.add(PageState())
        while (pages.size > n) pages.removeAt(pages.size - 1)
        for (i in 0 until n) {
            val v = Core.version(h, i)
            val p = pages[i]
            if (!force && v == p.ver) continue
            val pj = Core.call(h, "page", jo("page" to i)) as? JSONObject ?: continue
            val w = pj.optDouble("w", 816.0).toFloat(); val hh = pj.optDouble("h", 1056.0).toFloat()
            if (w != p.w || hh != p.hgt) relayout = true
            p.w = w; p.hgt = hh
            p.bg = pj.optJSONObject("bg"); p.paper = pj.optString("paper", "lined")
            p.itemsJson = pj.optJSONArray("items") ?: JSONArray()
            p.items = (0 until p.itemsJson.length()).map { k -> render.layoutItem(p.itemsJson.getJSONObject(k), w, misspelt) }
            p.ops = decodeGeom(Core.pageGeom(h, i))
            p.ver = v
        }
        if (relayout) layoutPages()
        invalidate()
    }

    fun relayoutItems() { for (p in pages) p.ver = -1; sync() }

    private fun layoutPages() {
        tops.clear()
        var y = 0f
        contentW = pages.maxOfOrNull { it.w } ?: 816f
        for (p in pages) { tops.add(y); y += p.hgt + GAP }
        contentH = max(y - GAP, 1f)
        fitScale()
    }
    private fun fitScale() {
        if (width == 0) return
        val fit = width / (contentW + 2 * SIDE)
        scale = fit * zoom
        clamp()
    }
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        val keep = if (oh > 0) (height / 2f - offY) / scale else 0f
        fitScale()
        if (oh > 0) offY = height / 2f - keep * scale
        clamp(); invalidate()
    }
    private fun pageX(i: Int) = (contentW - pages[i].w) / 2f
    private fun clamp() {
        val cw = contentW * scale
        offX = if (cw + 2 * SIDE * scale <= width) (width - cw) / 2f else offX.coerceIn(width - cw - SIDE * scale, SIDE * scale)
        val ch = contentH * scale
        offY = if (ch + 24 <= height) offY.coerceIn(12f, max(12f, height - ch - 12f)) else offY.coerceIn(height - ch - height * 0.5f, height * 0.25f)
    }

    /** Page under a screen point (nearest by y), with page coordinates. */
    private fun hit(sx: Float, sy: Float, strict: Boolean): Triple<Int, Float, Float>? {
        if (pages.isEmpty()) return null
        val y = (sy - offY) / scale
        var best = 0
        for (i in pages.indices) if (y >= tops[i] - GAP / 2) best = i
        val px = (sx - offX) / scale - pageX(best)
        val py = y - tops[best]
        if (strict && (px < 0 || py < 0 || px > pages[best].w || py > pages[best].hgt)) return null
        return Triple(best, px, py)
    }
    private fun toPage(i: Int, sx: Float, sy: Float) = ((sx - offX) / scale - pageX(i)) to ((sy - offY) / scale - tops[i])
    private fun toScreen(i: Int, x: Float, y: Float) = (offX + (pageX(i) + x) * scale) to (offY + (tops[i] + y) * scale)

    fun currentPage(): Int = hit(width / 2f, height / 3f, false)?.first ?: 0
    fun scrollToPage(i: Int) { if (i in tops.indices) { offY = 12f - tops[i] * scale; clamp(); invalidate(); onPageChanged(i) } }
    /** Centre of the visible area in page coordinates (for placing new things). */
    fun visibleSpot(): Triple<Int, Float, Float> {
        val (p, x, y) = hit(width / 2f, height / 3f, false) ?: Triple(0, 100f, 100f)
        return Triple(p, x.coerceIn(MARGIN_L, pages.getOrNull(p)?.w?.minus(200f) ?: 400f), y.coerceIn(64f, (pages.getOrNull(p)?.hgt ?: 900f) - 120f))
    }
    fun pageSize(i: Int) = pages.getOrNull(i)?.let { it.w to it.hgt } ?: (816f to 1056f)
    fun itemRects(page: Int): String {
        val a = JSONArray()
        pages.getOrNull(page)?.items?.forEach { a.put(JSONArray().put(it.id).put(it.rect.left).put(it.rect.top).put(it.rect.right).put(it.rect.bottom)) }
        return a.toString()
    }
    fun itemBox(page: Int, id: String) = pages.getOrNull(page)?.items?.firstOrNull { it.id == id }

    /* ---------------- input ---------------- */

    private enum class Mode { NONE, DRAW, PAN, DRAG_SEL, PALM }
    private var mode = Mode.NONE
    private var drawId = -1
    private var drawIsPen = false
    private var drawPage = 0
    private var downX = 0f; private var downY = 0f; private var downT = 0L
    private var moved = false
    private var lastPenSeen = 0L
    private var hover: PointF? = null
    private var hoverErase = false
    private var held = false
    private var holdX = 0f; private var holdY = 0f
    private val ui = Handler(Looper.getMainLooper())
    private val holdCheck = Runnable { if (mode == Mode.DRAW && Core.livePage(h) >= 0) { held = true; invalidate() } }
    private var lastPan = PointF()
    private var lastSpan = 0f
    private val scroller = OverScroller(context)
    private var vt: VelocityTracker? = null
    private var selRect: RectF? = null // page coords
    private var selDx = 0f; private var selDy = 0f
    private var selGhost: List<StrokeOp> = emptyList()
    private var lastTapT = 0L; private var lastTapX = 0f; private var lastTapY = 0f
    private val palmPx = 42f * resources.displayMetrics.density

    private fun isPen(ev: MotionEvent, i: Int) = ev.getToolType(i).let { it == MotionEvent.TOOL_TYPE_STYLUS || it == MotionEvent.TOOL_TYPE_ERASER }
    private fun penButton(ev: MotionEvent, i: Int) =
        ev.getToolType(i) == MotionEvent.TOOL_TYPE_ERASER || (ev.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY)) != 0

    override fun onHoverEvent(ev: MotionEvent): Boolean {
        if (isPen(ev, 0)) {
            lastPenSeen = SystemClock.uptimeMillis()
            hover = if (ev.actionMasked == MotionEvent.ACTION_HOVER_EXIT) null else PointF(ev.x, ev.y)
            hoverErase = penButton(ev, 0) || toolKind() == "eraser"
            invalidate()
            return true
        }
        return super.onHoverEvent(ev)
    }

    private fun startDraw(ev: MotionEvent, idx: Int, pen: Boolean) {
        val x = ev.getX(idx); val y = ev.getY(idx)
        val hp = hit(x, y, true) ?: return
        val (pg, px, py) = hp
        // touching the current selection moves it
        selRect?.let { r ->
            if (Core.call(h, "meta").let { (it as? JSONObject)?.optJSONObject("sel")?.optInt("page", -1) } == pg && r.contains(px, py)) {
                mode = Mode.DRAG_SEL; drawId = ev.getPointerId(idx); drawPage = pg; downX = px; downY = py; selDx = 0f; selDy = 0f
                val ss = Core.call(h, "selStrokes")
                selGhost = (Core.util("geom", jo("strokes" to ss)) as? JSONArray)?.let { a -> decodeGeom(FloatArray(a.length()) { a.getDouble(it).toFloat() }) } ?: emptyList()
                return
            }
        }
        val kind = toolKind()
        val btn = pen && penButton(ev, idx)
        if (kind == "text" && !btn) {
            mode = Mode.DRAW; drawId = ev.getPointerId(idx); drawPage = pg; downX = px; downY = py; downT = ev.eventTime; moved = false; drawIsPen = pen
            return
        }
        if (selRect != null && kind != "lasso") clearSelection()
        val rec = recording()
        val p = if (pen) ev.getPressure(idx).coerceIn(0.05f, 1f) else 0.5f
        Core.begin(h, pg, px, py, p, btn, rec?.first ?: -1, rec?.second ?: 0L)
        mode = Mode.DRAW; drawId = ev.getPointerId(idx); drawIsPen = pen; drawPage = pg
        downX = px; downY = py; downT = ev.eventTime; moved = false; held = false; holdX = px; holdY = py
        ui.removeCallbacks(holdCheck); ui.postDelayed(holdCheck, 450)
        invalidate()
    }

    private fun feedDraw(ev: MotionEvent) {
        val idx = ev.findPointerIndex(drawId)
        if (idx < 0) return
        val n = ev.historySize
        val arr = FloatArray((n + 1) * 4)
        for (k in 0..n) {
            val sx = if (k < n) ev.getHistoricalX(idx, k) else ev.getX(idx)
            val sy = if (k < n) ev.getHistoricalY(idx, k) else ev.getY(idx)
            val pr = if (!drawIsPen) 0.5f else (if (k < n) ev.getHistoricalPressure(idx, k) else ev.getPressure(idx)).coerceIn(0.05f, 1f)
            val t = (if (k < n) ev.getHistoricalEventTime(k) else ev.eventTime) - downT
            val (px, py) = toPage(drawPage, sx, sy)
            arr[k * 4] = px; arr[k * 4 + 1] = py; arr[k * 4 + 2] = pr; arr[k * 4 + 3] = t.toFloat()
            if (hypot(px - downX, py - downY) > 4f) moved = true
            if (hypot(px - holdX, py - holdY) > 3f / scale + 2f) {
                if (held) held = false
                holdX = px; holdY = py
                ui.removeCallbacks(holdCheck); ui.postDelayed(holdCheck, 450)
            }
        }
        if (toolKind() != "text" || Core.livePage(h) >= 0) Core.extend(h, arr)
        invalidate()
    }

    private fun finishDraw(ev: MotionEvent?) {
        ui.removeCallbacks(holdCheck)
        val pg = drawPage
        if (Core.livePage(h) < 0) {
            // text tool: tap places / edits text
            if (toolKind() == "text" && !moved) {
                val box = pages.getOrNull(pg)?.items?.lastOrNull { it.rect.contains(downX, downY) }
                if (box != null) onItemTap(pg, box.id) else onPlaceText(pg, downX, downY)
            }
            mode = Mode.NONE; return
        }
        // quick tap during playback = jump the recording to what was written there
        if (playRec >= 0 && !moved && ev != null && ev.eventTime - downT < 300) {
            Core.call(h, "cancel")
            (Core.call(h, "strokesAt", jo("page" to pg, "x" to downX, "y" to downY, "r" to 14f)) as? JSONArray)?.let { onSeek(it.getInt(0), it.getLong(1)) }
            mode = Mode.NONE; invalidate(); return
        }
        val r = Core.end(h, held, itemRects(pg))
        mode = Mode.NONE; held = false
        if (r == 3) refreshSelection() else if (r != 0) { sync(); onChanged() }
        invalidate()
    }

    fun refreshSelection() {
        val m = Core.call(h, "meta") as? JSONObject
        val sel = m?.optJSONObject("sel")
        selRect = null
        if (sel != null) {
            val b = Core.call(h, "selBounds", jo("rects" to JSONArray(itemRects(sel.optInt("page"))))) as? JSONArray
            if (b != null) selRect = RectF(b.getDouble(0).toFloat(), b.getDouble(1).toFloat(), b.getDouble(2).toFloat(), b.getDouble(3).toFloat())
        }
        sync()
        onSelection(selRect != null)
        invalidate()
    }
    fun clearSelection() { if (h != 0L) Core.call(h, "clearSel"); selRect = null; onSelection(false); sync() }
    /** Selection rectangle on screen (for placing the action bar). */
    fun selectionOnScreen(): RectF? {
        val r = selRect ?: return null
        val pg = (Core.call(h, "meta") as? JSONObject)?.optJSONObject("sel")?.optInt("page") ?: return null
        val (x0, y0) = toScreen(pg, r.left, r.top); val (x1, y1) = toScreen(pg, r.right, r.bottom)
        return RectF(x0, y0, x1, y1)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (h == 0L) return false
        if (vt == null) vt = VelocityTracker.obtain()
        val ai = ev.actionIndex
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                scroller.forceFinished(true)
                val pen = isPen(ev, ai)
                if (pen) {
                    lastPenSeen = SystemClock.uptimeMillis(); hover = null
                    if (mode == Mode.DRAW && !drawIsPen) Core.call(h, "cancel")
                    startDraw(ev, ai, true)
                    return true
                }
                // finger
                if (mode == Mode.DRAW && drawIsPen) return true                 // palm while writing
                if (mode == Mode.DRAG_SEL) return true
                val recentPen = SystemClock.uptimeMillis() - lastPenSeen < 700
                if (ev.getTouchMajor(ai) > palmPx * 1.6f || (recentPen && fingerCount(ev) == 1 && fingerDraws)) {
                    if (fingerCount(ev) == 1) mode = Mode.PALM
                    return true
                }
                val n = fingerCount(ev)
                if (n >= 2) {
                    if (mode == Mode.DRAW) Core.call(h, "cancel")
                    mode = Mode.PAN; startPan(ev)
                } else if (n == 1) {
                    vt?.clear(); vt?.addMovement(ev)
                    if (fingerDraws || (toolKind() == "text")) startDraw(ev, ai, false)
                    else if (!lock) { mode = Mode.PAN; startPan(ev) }
                    else { mode = Mode.NONE; downX = ev.getX(ai); downY = ev.getY(ai); downT = ev.eventTime }
                    // a deliberate one-finger touch with lock on still selects items by tapping
                }
            }
            MotionEvent.ACTION_MOVE -> {
                when (mode) {
                    Mode.DRAW -> feedDraw(ev)
                    Mode.PAN -> { vt?.addMovement(ev); pan(ev) }
                    Mode.DRAG_SEL -> {
                        val idx = ev.findPointerIndex(drawId)
                        if (idx >= 0) { val (px, py) = toPage(drawPage, ev.getX(idx), ev.getY(idx)); selDx = px - downX; selDy = py - downY; invalidate() }
                    }
                    else -> {}
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val id = ev.getPointerId(ai)
                if ((mode == Mode.DRAW || mode == Mode.DRAG_SEL) && id == drawId) { if (mode == Mode.DRAW) finishDraw(ev) else endDrag() }
                else if (mode == Mode.PAN) startPan(ev, ai)
            }
            MotionEvent.ACTION_UP -> {
                when (mode) {
                    Mode.DRAW -> finishDraw(ev)
                    Mode.DRAG_SEL -> endDrag()
                    Mode.PAN -> {
                        vt?.addMovement(ev); vt?.computeCurrentVelocity(1000)
                        val vx = vt?.xVelocity ?: 0f; val vy = vt?.yVelocity ?: 0f
                        if (abs(vy) > 400 || abs(vx) > 400) {
                            scroller.fling(offX.toInt(), offY.toInt(), vx.toInt(), vy.toInt(), Int.MIN_VALUE, Int.MAX_VALUE, Int.MIN_VALUE, Int.MAX_VALUE)
                            postInvalidateOnAnimation()
                        }
                    }
                    Mode.NONE -> {
                        // locked single-finger tap: open the item under it
                        if (hypot(ev.x - downX, ev.y - downY) < 12 && ev.eventTime - downT < 300) hit(ev.x, ev.y, true)?.let { (pg, px, py) ->
                            pages[pg].items.lastOrNull { it.rect.contains(px, py) }?.let { onItemTap(pg, it.id) }
                        }
                    }
                    else -> {}
                }
                // finger double-tap on an item opens it for editing
                if (!isPen(ev, 0) && mode != Mode.DRAW) {
                    val now = ev.eventTime
                    if (now - lastTapT < 320 && hypot(ev.x - lastTapX, ev.y - lastTapY) < 40) hit(ev.x, ev.y, true)?.let { (pg, px, py) ->
                        pages[pg].items.lastOrNull { it.rect.contains(px, py) }?.let { onItemTap(pg, it.id) }
                    }
                    lastTapT = now; lastTapX = ev.x; lastTapY = ev.y
                }
                mode = Mode.NONE
                vt?.recycle(); vt = null
                onPageChanged(currentPage())
            }
            MotionEvent.ACTION_CANCEL -> {
                if (mode == Mode.DRAW) Core.call(h, "cancel")
                mode = Mode.NONE; ui.removeCallbacks(holdCheck); invalidate()
            }
        }
        return true
    }

    private fun fingerCount(ev: MotionEvent): Int {
        var n = 0
        for (i in 0 until ev.pointerCount) {
            if (isPen(ev, i)) continue
            if (ev.actionMasked == MotionEvent.ACTION_POINTER_UP && i == ev.actionIndex) continue
            if (ev.getTouchMajor(i) > palmPx * 1.6f) continue
            n++
        }
        return n
    }

    private fun focus(ev: MotionEvent, skip: Int = -1): Triple<Float, Float, Float> {
        var sx = 0f; var sy = 0f; var n = 0
        for (i in 0 until ev.pointerCount) if (i != skip && !isPen(ev, i)) { sx += ev.getX(i); sy += ev.getY(i); n++ }
        if (n == 0) return Triple(ev.x, ev.y, 0f)
        val cx = sx / n; val cy = sy / n
        var span = 0f
        for (i in 0 until ev.pointerCount) if (i != skip && !isPen(ev, i)) span += hypot(ev.getX(i) - cx, ev.getY(i) - cy)
        return Triple(cx, cy, if (n > 1) span / n else 0f)
    }
    private fun startPan(ev: MotionEvent, skip: Int = -1) { val (x, y, s) = focus(ev, skip); lastPan.set(x, y); lastSpan = s }
    private fun pan(ev: MotionEvent) {
        val (x, y, s) = focus(ev)
        offX += x - lastPan.x; offY += y - lastPan.y
        if (s > 0 && lastSpan > 0) {
            val f = s / lastSpan
            val nz = (zoom * f).coerceIn(0.5f, 5f)
            val k = nz / zoom
            zoom = nz; scale *= k
            offX = x - (x - offX) * k; offY = y - (y - offY) * k
        }
        lastPan.set(x, y); lastSpan = s
        clamp(); invalidate()
    }
    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            offX = scroller.currX.toFloat(); offY = scroller.currY.toFloat()
            val bx = offX; val by = offY
            clamp()
            if (bx != offX && by != offY) scroller.forceFinished(true)
            postInvalidateOnAnimation()
        }
    }
    fun zoomTo(z: Float) {
        val cx = width / 2f; val cy = height / 2f
        val nz = z.coerceIn(0.5f, 5f); val k = nz / zoom
        zoom = nz; scale *= k; offX = cx - (cx - offX) * k; offY = cy - (cy - offY) * k
        clamp(); invalidate()
    }
    val zoomLevel get() = zoom

    private fun endDrag() {
        if (abs(selDx) > 0.5f || abs(selDy) > 0.5f) {
            Core.call(h, "moveSel", jo("dx" to selDx, "dy" to selDy))
            selRect?.offset(selDx, selDy)
            onChanged()
        }
        selDx = 0f; selDy = 0f; selGhost = emptyList(); mode = Mode.NONE
        sync(); onSelection(selRect != null)
    }

    /* ---------------- drawing ---------------- */

    private val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x22000000 }
    private val selPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF2563EB.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.5f; pathEffect = DashPathEffect(floatArrayOf(7f, 5f), 0f) }
    private val selFill = Paint().apply { color = 0x102563EB }
    private val cursor = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.5f; color = 0x99000000.toInt() }
    private val pnum = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFB8B1A0.toInt(); textSize = 12f; textAlign = Paint.Align.RIGHT }

    override fun onDraw(c: Canvas) {
        // Compose hosts this view without clipping: never paint outside our own bounds
        c.clipRect(0, 0, width, height)
        c.drawColor(0xFFECE7DC.toInt())
        if (h == 0L) return
        val livePg = Core.livePage(h)
        val sel = selRect
        val selPage = if (sel != null) (Core.call(h, "meta") as? JSONObject)?.optJSONObject("sel")?.optInt("page", -1) ?: -1 else -1
        for (i in pages.indices) {
            val p = pages[i]
            val (sx, sy) = toScreen(i, 0f, 0f)
            if (sy > height || sy + p.hgt * scale < 0) continue
            c.save()
            c.translate(sx, sy); c.scale(scale, scale)
            c.drawRect(1f, 3f, p.w + 1f, p.hgt + 4f, shadow)
            c.save(); c.clipRect(0f, 0f, p.w, p.hgt)
            drawPage(c, i, false)
            if (i == selPage && sel != null) {
                c.save(); c.translate(selDx, selDy)
                for (op in selGhost) c.drawPath(op.path, op.paint)
                c.drawRect(sel, selFill); c.drawRect(sel, selPaint)
                c.restore()
            }
            if (i == livePg) for (op in decodeGeom(Core.liveGeom(h, held))) c.drawPath(op.path, op.paint)
            c.restore()
            c.drawText("${i + 1}", p.w - MARGIN_R, p.hgt - 18f, pnum)
            c.restore()
        }
        hover?.let { hp ->
            val r = if (hoverErase) eraserRadius() * scale else 3f
            cursor.color = if (hoverErase) 0x99000000.toInt() else 0x66000000
            c.drawCircle(hp.x, hp.y, r, cursor)
        }
    }

    /** Draw page `i` in page coordinates (also used for PDF export). */
    fun drawPage(c: Canvas, i: Int, export: Boolean) {
        val p = pages[i]
        val bg = p.bg
        if (bg != null) {
            c.drawColor(Color.WHITE)
            val px = if (export) 2600 else (p.w * scale).toInt()
            render.drawPdf(c, render.ctx.let { File(File(it.filesDir, "media"), bg.optString("pdf")) }, bg.optInt("page"), p.w, p.hgt, px, export)
        } else render.drawPaper(c, p.w, p.hgt, if (export && p.paper == "lined") "lined" else p.paper, whitePaper || export && p.paper == "plain")
        for (b in p.items) b.draw(c)
        val fade = playRec >= 0
        for (op in p.ops) {
            if (fade && op.rec == playRec && op.ms > playMs) {
                val a = op.paint.alpha; op.paint.alpha = (a * 0.22f).toInt()
                c.drawPath(op.path, op.paint); op.paint.alpha = a
            } else c.drawPath(op.path, op.paint)
        }
    }

    fun pageCount() = pages.size
    fun pageW(i: Int) = pages[i].w
    fun pageH(i: Int) = pages[i].hgt

    init {
        render.onAsyncReady = { invalidate() }
        isFocusable = true
    }
}
