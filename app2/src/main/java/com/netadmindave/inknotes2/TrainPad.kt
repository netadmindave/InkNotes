package com.netadmindave.inknotes2

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import org.json.JSONArray
import org.json.JSONObject

/** A small writing square for handwriting training. */
@SuppressLint("ViewConstructor")
class TrainPad(context: Context) : View(context) {
    private val strokes = ArrayList<ArrayList<FloatArray>>()
    private var t0 = 0L
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = INK; style = Paint.Style.STROKE; strokeWidth = 5f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val guide = Paint().apply { color = 0xFFC9D8EA.toInt(); strokeWidth = 2f }
    var onChange: () -> Unit = {}

    fun clear() { strokes.clear(); invalidate(); onChange() }
    val empty get() = strokes.isEmpty()
    fun json(): JSONArray = JSONArray().apply {
        for (s in strokes) put(JSONObject().put("c", "#000000").put("s", 2.0).put("p", JSONArray().apply { for (q in s) put(JSONArray().put(q[0].toDouble()).put(q[1].toDouble()).put(0.5).put(q[2].toDouble())) }))
    }

    fun undo() { if (strokes.isNotEmpty()) { strokes.removeAt(strokes.size - 1); invalidate(); onChange() } }

    /** Strokes grouped into separate symbols (side by side, gaps between): write a symbol several times, save them all. */
    fun groups(): List<JSONArray> {
        val all = json()
        if (strokes.isEmpty()) return emptyList()
        val boxes = strokes.map { s -> floatArrayOf(s.minOf { it[0] }, s.minOf { it[1] }, s.maxOf { it[0] }, s.maxOf { it[1] }) }
        val hs = boxes.map { it[3] - it[1] }.sorted()
        val gapMin = (hs[hs.size / 2] * 0.25f).coerceAtLeast(8f)
        val order = boxes.indices.sortedBy { boxes[it][0] }
        val out = ArrayList<MutableList<Int>>()
        var right = -1e9f
        for (i in order) {
            if (out.isEmpty() || boxes[i][0] > right + gapMin) { out.add(mutableListOf(i)); right = boxes[i][2] }
            else { out.last().add(i); right = maxOf(right, boxes[i][2]) }
        }
        return out.map { g -> JSONArray().apply { g.sorted().forEach { put(all.getJSONObject(it)) } } }
    }

    private var erasing = false
    private fun eraseAt(x: Float, y: Float) {
        val r = 22f
        if (strokes.removeAll { s -> s.any { q -> Math.hypot((q[0] - x).toDouble(), (q[1] - y).toDouble()) < r } }) onChange()
    }

    private var penSeen = false          // once a stylus is used, fingers and palms never draw
    private var activeId = -1
    private val palmPx = 11f * resources.displayMetrics.xdpi / 25.4f

    private fun isPen(e: MotionEvent, i: Int) = e.getToolType(i).let { it == MotionEvent.TOOL_TYPE_STYLUS || it == MotionEvent.TOOL_TYPE_ERASER }

    override fun onHoverEvent(e: MotionEvent): Boolean { if (isPen(e, 0)) penSeen = true; return super.onHoverEvent(e) }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val ai = e.actionIndex
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val pen = isPen(e, ai)
                if (pen) penSeen = true
                // ignore palms/fingers when writing with a pen, big contacts always, and a second touch while one is active
                if (activeId != -1 && !pen) return true
                if (!pen && (penSeen || e.getTouchMajor(ai) > palmPx)) return true
                if (activeId != -1 && pen) { strokes.lastOrNull()?.let { if (!erasing && it.size < 3) strokes.removeAt(strokes.size - 1) } }
                activeId = e.getPointerId(ai)
                // the training screen scrolls; keep the whole stroke for the pad
                parent?.requestDisallowInterceptTouchEvent(true)
                // S Pen side button (or the pen's eraser end) erases whole strokes here
                erasing = e.getToolType(ai) == MotionEvent.TOOL_TYPE_ERASER ||
                    (e.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY)) != 0
                val x = e.getX(ai); val y = e.getY(ai)
                if (erasing) eraseAt(x, y)
                else { if (strokes.isEmpty()) t0 = e.eventTime; strokes.add(arrayListOf(floatArrayOf(x, y, (e.eventTime - t0).toFloat()))) }
            }
            MotionEvent.ACTION_MOVE -> {
                val i = e.findPointerIndex(activeId)
                if (i < 0) return true
                if (erasing) eraseAt(e.getX(i), e.getY(i)) else strokes.lastOrNull()?.let { s ->
                    for (k in 0 until e.historySize) s.add(floatArrayOf(e.getHistoricalX(i, k), e.getHistoricalY(i, k), (e.getHistoricalEventTime(k) - t0).toFloat()))
                    s.add(floatArrayOf(e.getX(i), e.getY(i), (e.eventTime - t0).toFloat()))
                }
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val id = if (e.actionMasked == MotionEvent.ACTION_CANCEL) activeId else e.getPointerId(ai)
                if (id == activeId) {
                    if (e.actionMasked == MotionEvent.ACTION_CANCEL && !erasing) strokes.removeLastOrNull()
                    activeId = -1; erasing = false
                    parent?.requestDisallowInterceptTouchEvent(false); onChange()
                }
            }
        }
        invalidate(); return true
    }

    override fun onDraw(c: Canvas) {
        // hosted in Compose without clipping: stay inside our own box
        c.clipRect(0, 0, width, height)
        c.drawColor(PAPER)
        c.drawLine(0f, height * 0.7f, width.toFloat(), height * 0.7f, guide)
        c.drawLine(0f, height * 0.3f, width.toFloat(), height * 0.3f, guide)
        for (s in strokes) {
            val p = Path(); p.moveTo(s[0][0], s[0][1]); for (q in s) p.lineTo(q[0], q[1])
            c.drawPath(p, ink)
        }
    }
}
