package com.netadmindave.inknotes2

import org.json.JSONArray
import org.json.JSONObject

/** The Rust engine (libinkcore.so). */
object Core {
    init { System.loadLibrary("inkcore") }

    external fun open(json: String): Long
    external fun free(h: Long)
    external fun begin(h: Long, page: Int, x: Float, y: Float, p: Float, buttonErase: Boolean, rec: Int, recMs: Long)
    external fun extend(h: Long, pts: FloatArray)
    external fun end(h: Long, held: Boolean, itemRects: String): Int
    external fun livePage(h: Long): Int
    external fun liveGeom(h: Long, held: Boolean): FloatArray
    external fun pageGeom(h: Long, page: Int): FloatArray
    external fun version(h: Long, page: Int): Long
    external fun takeDirty(h: Long): Boolean
    external fun call(h: Long, op: String, arg: String): String
    external fun util(op: String, arg: String): String

    fun call(h: Long, op: String, arg: JSONObject = JSONObject()): Any? = parse(call(h, op, arg.toString()))
    fun util(op: String, arg: Any): Any? = parse(util(op, if (arg is String) arg else arg.toString()))
    fun utilRaw(op: String, raw: String): Any? = parse(util(op, raw))

    private fun parse(s: String): Any? = try {
        when {
            s == "null" -> null
            s.startsWith("{") -> JSONObject(s)
            s.startsWith("[") -> JSONArray(s)
            s.startsWith("\"") -> JSONArray("[$s]").getString(0)
            s == "true" -> true
            s == "false" -> false
            else -> s.toDoubleOrNull()
        }
    } catch (e: Exception) { null }

    fun tex(src: String): String = (utilRaw("tex", src) as? String) ?: src
}

fun jo(vararg kv: Pair<String, Any?>): JSONObject = JSONObject().apply { for ((k, v) in kv) put(k, v ?: JSONObject.NULL) }
