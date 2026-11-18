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

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.pointerCount > 1) return true
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { if (strokes.isEmpty()) t0 = e.eventTime; strokes.add(arrayListOf(floatArrayOf(e.x, e.y, (e.eventTime - t0).toFloat()))) }
            MotionEvent.ACTION_MOVE -> strokes.lastOrNull()?.let { s ->
                for (k in 0 until e.historySize) s.add(floatArrayOf(e.getHistoricalX(k), e.getHistoricalY(k), (e.getHistoricalEventTime(k) - t0).toFloat()))
                s.add(floatArrayOf(e.x, e.y, (e.eventTime - t0).toFloat()))
            }
            MotionEvent.ACTION_UP -> onChange()
        }
        invalidate(); return true
    }

    override fun onDraw(c: Canvas) {
        c.drawColor(PAPER)
        c.drawLine(0f, height * 0.7f, width.toFloat(), height * 0.7f, guide)
        c.drawLine(0f, height * 0.3f, width.toFloat(), height * 0.3f, guide)
        for (s in strokes) {
            val p = Path(); p.moveTo(s[0][0], s[0][1]); for (q in s) p.lineTo(q[0], q[1])
            c.drawPath(p, ink)
        }
    }
}
