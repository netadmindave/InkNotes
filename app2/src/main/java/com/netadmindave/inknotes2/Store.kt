package com.netadmindave.inknotes2

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class NoteInfo(val id: String, val title: String, val preview: String, val updated: Long, val pages: Int, val pinned: Boolean)

/** Notes as JSON files, media (PDFs, pictures, recordings) as plain files, settings in SharedPreferences. */
class Store(val ctx: Context) {
    val notesDir = File(ctx.filesDir, "notes").apply { mkdirs() }
    val mediaDir = File(ctx.filesDir, "media").apply { mkdirs() }
    private val prefs = ctx.getSharedPreferences("inknotes2", Context.MODE_PRIVATE)

    fun pref(k: String, d: String) = prefs.getString(k, d) ?: d
    fun pref(k: String, d: Boolean) = prefs.getBoolean(k, d)
    fun pref(k: String, d: Float) = prefs.getFloat(k, d)
    fun set(k: String, v: Any) {
        prefs.edit().apply {
            when (v) { is String -> putString(k, v); is Boolean -> putBoolean(k, v); is Float -> putFloat(k, v); is Int -> putInt(k, v) }
        }.apply()
    }

    fun list(): List<NoteInfo> = (notesDir.listFiles() ?: emptyArray()).filter { it.name.endsWith(".json") }.mapNotNull { f ->
        val p = Core.utilRaw("preview", f.readText()) as? JSONObject ?: return@mapNotNull null
        NoteInfo(p.optString("id"), p.optString("title"), p.optString("preview"), p.optLong("updated"), p.optInt("pages"), p.optBoolean("pinned"))
    }.sortedWith(compareByDescending<NoteInfo> { it.pinned }.thenByDescending { it.updated })

    fun load(id: String): String? = File(notesDir, "$id.json").takeIf { it.exists() }?.readText()
    fun save(id: String, json: String) {
        val tmp = File(notesDir, "$id.json.tmp")
        tmp.writeText(json)
        tmp.renameTo(File(notesDir, "$id.json"))
    }
    fun delete(id: String) { File(notesDir, "$id.json").delete() }

    fun create(title: String = ""): String {
        val json = Core.util("newNote", jo("now" to System.currentTimeMillis(), "paper" to pref("paper", "lined"),
            "size" to pref("size", "letter"), "title" to title)) as String
        val id = JSONObject(json).getString("id")
        save(id, json)
        return id
    }

    fun setPinned(id: String, pinned: Boolean) {
        val j = JSONObject(load(id) ?: return)
        j.put("pinned", pinned)
        save(id, j.toString())
    }

    var userWords: Set<String>
        get() = try { JSONArray(pref("userDict", "[]")).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } } catch (e: Exception) { emptySet() }
        set(v) = set("userDict", JSONArray(v.toList()).toString())

    /** Copy a picked file into media/, return the new file name. */
    fun importMedia(uri: Uri, ext: String): String? = try {
        val name = "m${System.currentTimeMillis()}.$ext"
        ctx.contentResolver.openInputStream(uri)!!.use { i -> File(mediaDir, name).outputStream().use { o -> i.copyTo(o) } }
        name
    } catch (e: Exception) { null }

    fun media(name: String) = File(mediaDir, name)

    /** InkNotes 1.x or 2.x backup → number of notes imported (existing notes with the same id are kept unless newer). */
    fun importBackup(json: String): Int {
        val o = JSONObject(json)
        val notes = o.optJSONArray("notes") ?: return 0
        var n = 0
        for (i in 0 until notes.length()) {
            val raw = notes.optJSONObject(i)?.toString() ?: continue
            val migrated = Core.utilRaw("migrate", raw) as? String ?: continue
            val m = JSONObject(migrated)
            val id = m.getString("id")
            val old = load(id)?.let { JSONObject(it) }
            if (old != null && old.optLong("updated") >= m.optLong("updated")) continue
            save(id, migrated); n++
        }
        o.optJSONArray("userDict")?.let { a -> userWords = userWords + (0 until a.length()).map { a.getString(it) } }
        o.optJSONObject("hwSamples")?.let { Core.utilRaw("trainLoad", it.toString()); set("hwSamples", it.toString()) }
        // media embedded as base64 (2.x backups)
        o.optJSONObject("media")?.let { md -> md.keys().forEach { k -> val f = media(k); if (!f.exists()) f.writeBytes(android.util.Base64.decode(md.getString(k), 0)) } }
        return n
    }

    fun exportBackup(withMedia: Boolean): String {
        val notes = JSONArray()
        (notesDir.listFiles() ?: emptyArray()).filter { it.name.endsWith(".json") }.forEach { notes.put(JSONObject(it.readText())) }
        val o = jo("app" to "InkNotes", "version" to 2, "exported" to System.currentTimeMillis(), "userDict" to JSONArray(userWords.toList()), "notes" to notes)
        pref("hwSamples", "").takeIf { it.isNotEmpty() }?.let { o.put("hwSamples", JSONObject(it)) }
        if (withMedia) {
            val md = JSONObject()
            (mediaDir.listFiles() ?: emptyArray()).forEach { md.put(it.name, android.util.Base64.encodeToString(it.readBytes(), android.util.Base64.NO_WRAP)) }
            o.put("media", md)
        }
        return o.toString()
    }
}
