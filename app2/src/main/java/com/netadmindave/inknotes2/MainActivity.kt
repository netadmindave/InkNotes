package com.netadmindave.inknotes2

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.DateFormat
import java.util.Date

val Hand = FontFamily(Font(R.font.caveat))
val Paper = Color(0xFFFBF8F1)
val Desk = Color(0xFFECE7DC)
val Accent = Color(0xFF5B2A6E)
val InkC = Color(0xFF1D3557)
val COLORS = listOf("#1d3557", "#111111", "#c2410c", "#2f7d32", "#7b2cbf", "#2563eb", "#db2777", "#f5c518")
val ERASER_SIZES = listOf(5f to "XS", 10f to "S", 18f to "M", 30f to "L", 50f to "XL")

class ItemEdit(val page: Int, val item: JSONObject)

class MainActivity : ComponentActivity() {
    lateinit var store: Store
    lateinit var render: Renderer
    lateinit var ink: InkView
    lateinit var voice: Voice

    // note
    var h = 0L
    var noteId by mutableStateOf<String?>(null)
    var title by mutableStateOf("")
    var canUndo by mutableStateOf(false)
    var canRedo by mutableStateOf(false)
    var pageNo by mutableStateOf(0)
    var pageCount by mutableStateOf(1)
    var notes by mutableStateOf(listOf<NoteInfo>())
    var recordings by mutableStateOf(listOf<Pair<String, Long>>())

    // tools
    var tool by mutableStateOf("pen")
    var color by mutableStateOf("#1d3557")
    var size by mutableStateOf(2.5f)
    var dash by mutableStateOf("")
    var shapes by mutableStateOf(false)
    var eraserSize by mutableStateOf(10f)
    var eraserWhole by mutableStateOf(false)
    var fingerDraws by mutableStateOf(false)
    var lock by mutableStateOf(true)

    // ui
    var drawer by mutableStateOf(true)
    var hasSel by mutableStateOf(false)
    var keepInk by mutableStateOf(false)
    var busy by mutableStateOf<String?>(null)
    var editing by mutableStateOf<ItemEdit?>(null)
    var training by mutableStateOf(false)
    var settings by mutableStateOf(false)
    var askModel by mutableStateOf(false)
    var recMs by mutableStateOf(-1L)
    var playIdx by mutableStateOf(-1)
    var playPos by mutableStateOf(0L)
    var playLen by mutableStateOf(1L)
    var font by mutableStateOf("caveat")
    var textScale by mutableStateOf(0.8f)
    var autoMath by mutableStateOf(true)
    var whitePaper by mutableStateOf(false)
    var search by mutableStateOf("")
    var pdfPick by mutableStateOf<PdfPick?>(null)
    var pdfChooser by mutableStateOf(false)
    var cropping by mutableStateOf<ItemEdit?>(null)
    var pdfAsPicture by mutableStateOf(false)
    var review by mutableStateOf<List<ReviewRow>?>(null)

    fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        render = Renderer(this)
        voice = Voice(this, store)
        ink = InkView(this, render)
        try { Class.forName("ru.noties.jlatexmath.JLatexMathAndroid").getMethod("init", android.content.Context::class.java).invoke(null, this) } catch (_: Throwable) {}
        loadPrefs()
        store.pref("hwSamples", "").takeIf { it.isNotEmpty() }?.let { Core.utilRaw("trainLoad", it) }
        wireInk()
        lifecycleScope.launch { Recognizer.init() }
        refreshList()
        val last = store.pref("lastNote", "")
        if (last.isNotEmpty() && store.load(last) != null) openNote(last) else if (notes.isNotEmpty()) openNote(notes[0].id) else openNote(store.create())
        handleIntent(intent)
        setContent { MaterialTheme(colorScheme = lightColorScheme(primary = Accent, secondary = InkC, surface = Paper, background = Desk)) { Root() } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        if (i?.action == Intent.ACTION_VIEW && i.data != null && (i.type == "application/pdf" || i.data.toString().endsWith(".pdf"))) { if (pdfAsPicture) pdfForPicture(i.data!!) else importPdf(i.data!!, true) }
    }

    /** "Question from PDF": recent PDFs first, otherwise the file picker. */
    fun startPdfQuestion() { if (recentPdfs().isEmpty()) pickPdfPicture.launch(arrayOf("application/pdf")) else pdfChooser = true }
    fun pdfForPicture(uri: Uri) {
        lifecycleScope.launch {
            val name = withContext(Dispatchers.IO) { store.importMedia(uri, "pdf") } ?: return@launch toast("Couldn't open that PDF")
            choosePage(name, displayName(uri)?.removeSuffix(".pdf") ?: "PDF")
        }
    }

    private fun loadPrefs() {
        tool = store.pref("tool", "pen"); color = store.pref("color", "#1d3557"); size = store.pref("size2", 2.5f)
        dash = store.pref("dash", ""); shapes = store.pref("shapes", false); eraserSize = store.pref("eraserSize", 10f)
        eraserWhole = store.pref("eraserWhole", false); fingerDraws = store.pref("fingerDraws", false); lock = store.pref("lock", true)
        font = store.pref("font", "caveat"); textScale = store.pref("textScale", 0.8f); autoMath = store.pref("autoMath", true)
        whitePaper = store.pref("whitePaper", false); pdfAsPicture = store.pref("pdfAsPicture", false); drawer = store.pref("drawer", true)
        render.font = font; render.textScale = textScale; render.autoMath = autoMath
        ink.fingerDraws = fingerDraws; ink.lock = lock; ink.whitePaper = whitePaper
    }

    fun pushTool() {
        if (h == 0L) return
        Core.call(h, "tool", jo("kind" to (if (tool == "text") "pen" else tool), "color" to color, "size" to size.toDouble(), "dash" to dash,
            "shapes" to shapes, "eraserSize" to eraserSize.toDouble(), "eraserWhole" to eraserWhole))
        store.set("tool", tool); store.set("color", color); store.set("size2", size); store.set("dash", dash); store.set("shapes", shapes)
        store.set("eraserSize", eraserSize); store.set("eraserWhole", eraserWhole)
        if (tool != "lasso" && hasSel) ink.clearSelection()
    }

    private fun wireInk() {
        ink.toolKind = { tool }
        ink.eraserRadius = { eraserSize }
        ink.recording = { if (voice.recording && voice.recIndex >= 0) voice.recIndex to voice.elapsed() else null }
        ink.onChanged = { changed() }
        ink.onSelection = { hasSel = it }
        ink.onPageChanged = { pageNo = it }
        ink.onPlaceText = { pg, x, y ->
            val item = jo("id" to newItemId(), "type" to "text", "x" to x.toDouble(), "y" to (Math.floor(y / LINE.toDouble()) * LINE), "w" to 0, "src" to "")
            editing = ItemEdit(pg, item)
        }
        ink.onItemTap = { pg, id ->
            val p = Core.call(h, "page", jo("page" to pg)) as? JSONObject
            val arr = p?.optJSONArray("items")
            if (arr != null) for (k in 0 until arr.length()) if (arr.getJSONObject(k).optString("id") == id) {
                val o = arr.getJSONObject(k)
                if (o.optString("type") == "image") cropping = ItemEdit(pg, o) else editing = ItemEdit(pg, o)
            }
        }
        ink.onSeek = { rec, ms -> playRecording(rec, ms) }
    }

    fun newItemId() = "i" + java.lang.Long.toString(System.currentTimeMillis(), 36) + (Math.random() * 1296).toInt().toString(36)

    /* ---------- notes ---------- */

    fun refreshList() { notes = store.list() }

    fun openNote(id: String) {
        saveNow()
        if (voice.recording) stopRecording()
        stopPlayback()
        if (h != 0L) { ink.close(); Core.free(h); h = 0L }
        val json = store.load(id) ?: return
        h = Core.open(json)
        if (h == 0L) { toast("Couldn't open that note"); return }
        noteId = id
        store.set("lastNote", id)
        pushTool()
        ink.open(h)
        hasSel = false
        refreshMeta()
    }

    fun refreshMeta() {
        val m = Core.call(h, "meta") as? JSONObject ?: return
        title = m.optString("title"); canUndo = m.optBoolean("undo"); canRedo = m.optBoolean("redo"); pageCount = m.optInt("pages")
        val r = m.optJSONArray("recordings") ?: JSONArray()
        recordings = (0 until r.length()).map { r.getJSONObject(it).let { o -> o.optString("file") to o.optLong("ms") } }
    }

    private var saveJob: kotlinx.coroutines.Job? = null
    fun changed() {
        refreshMeta()
        saveJob?.cancel()
        saveJob = lifecycleScope.launch { delay(700); saveNow() }
    }
    fun saveNow() {
        if (h == 0L) return
        if (!Core.takeDirty(h)) return
        val json = Core.call(h, "json") as? String ?: return
        val o = JSONObject(json); o.put("updated", System.currentTimeMillis())
        noteId?.let { store.save(it, o.toString()) }
        refreshList()
    }
    override fun onPause() { super.onPause(); saveNow() }

    fun newNote() { saveNow(); val id = store.create(); refreshList(); openNote(id) }

    fun deleteNote(id: String) {
        store.delete(id)
        if (id == noteId) { if (h != 0L) { ink.close(); Core.free(h); h = 0L }; noteId = null }
        refreshList()
        if (noteId == null) { if (notes.isNotEmpty()) openNote(notes[0].id) else newNote() }
    }

    fun op(name: String, arg: JSONObject = JSONObject()) { Core.call(h, name, arg); ink.sync(); changed() }

    /* ---------- conversion ---------- */

    fun convert(mode: String) {
        if (Recognizer.state != "ready") { askModel = true; return }
        val strokes = Core.call(h, "selStrokes") as? JSONArray ?: return
        if (strokes.length() == 0) { toast("Lasso some handwriting first"); return }
        busy = "Reading your writing…"
        lifecycleScope.launch {
            try {
                val pieces = Recognizer.convert(strokes, mode)
                // the same strokes the engine saw (highlighter ignored), for bounds and the "before" picture
                val used = (0 until strokes.length()).map { strokes.getJSONObject(it) }.filter { it.optString("k") != "hl" && (it.optJSONArray("p")?.length() ?: 0) > 0 }
                val words = store.userWords.toList()
                val rows = ArrayList<ReviewRow>()
                for (pc in pieces) {
                    var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y1 = -Float.MAX_VALUE
                    val mine = JSONArray()
                    for (k in pc.strokes) used.getOrNull(k)?.let { st -> mine.put(st); st.optJSONArray("p")?.let { p -> for (j in 0 until p.length()) { val q = p.getJSONArray(j); val x = q.getDouble(0).toFloat(); val y = q.getDouble(1).toFloat(); x0 = minOf(x0, x); y0 = minOf(y0, y); x1 = maxOf(x1, x); y1 = maxOf(y1, y) } } }
                    if (x0 == Float.MAX_VALUE) continue
                    val src = if (pc.kind == "text") ((Core.util("clean", jo("text" to pc.src, "words" to JSONArray(words), "autoMath" to autoMath)) as? JSONObject)?.optString("text") ?: pc.src) else pc.src
                    val bm = withContext(Dispatchers.Default) { inkBitmap(mine) }
                    rows.add(ReviewRow(bm, x0, y0, y1, pc.kind, if (pc.kind == "text") src else "", if (pc.kind == "math") srcToLatex(src) else "", pc.alts.filter { it.isNotBlank() && it != src }.take(4)))
                }
                if (rows.isEmpty()) toast("Couldn't read that — try writing a little larger") else review = rows
            } catch (e: Exception) { toast(e.message ?: "Conversion failed") }
            busy = null
        }
    }

    /** Put the checked conversion on the page (replacing the lassoed ink unless "keep ink"). */
    fun applyReview(rows: List<ReviewRow>) {
        val items = JSONArray()
        for (r in rows) {
            if (r.skip) continue
            if (r.kind == "text") {
                if (r.text.isBlank()) continue
                val top = Math.floor((r.y0 + minOf(r.y1 - r.y0, LINE) * 0.5) / LINE) * LINE
                items.put(jo("id" to newItemId(), "type" to "text", "x" to r.x0.toDouble(), "y" to top, "w" to 0, "src" to r.text))
            } else {
                if (r.tex.isBlank()) continue
                items.put(jo("id" to newItemId(), "type" to "math", "x" to r.x0.toDouble(), "y" to r.y0.toDouble(), "w" to 0, "src" to latexToSrc(r.tex)))
            }
        }
        review = null
        if (items.length() > 0) { Core.call(h, "replaceSel", jo("items" to items, "keepInk" to keepInk)); ink.sync(); changed() }
        ink.clearSelection(); hasSel = false
    }

    /* ---------- media ---------- */

    fun importPdf(uri: Uri, asNewNote: Boolean) {
        busy = "Importing PDF…"
        lifecycleScope.launch {
            val name = withContext(Dispatchers.IO) { store.importMedia(uri, "pdf") }
            val info = if (name != null) withContext(Dispatchers.IO) { render.pdfInfo(store.media(name)) } else emptyList()
            busy = null
            if (name == null || info.isEmpty()) { toast("Couldn't open that PDF"); return@launch }
            if (asNewNote) { saveNow(); val id = store.create(displayName(uri)?.removeSuffix(".pdf") ?: "PDF"); openNote(id) }
            op("addPdf", jo("pdf" to name, "pages" to JSONArray(info.map { JSONArray().put(it.first.toDouble()).put(it.second.toDouble()) }), "now" to System.currentTimeMillis(), "replaceBlank" to asNewNote))
            ink.sync(true)
            refreshMeta()
            toast("${info.size} page${if (info.size == 1) "" else "s"} added")
        }
    }
    private fun displayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (_: Exception) { null }

    fun addImage(uri: Uri) {
        val name = store.importMedia(uri, "jpg") ?: return toast("Couldn't add that picture")
        val (pg, x, y) = ink.visibleSpot()
        val w = minOf(360f, ink.pageSize(pg).first - x - MARGIN_R)
        Core.call(h, "upsertItem", jo("page" to pg, "item" to jo("id" to newItemId(), "type" to "image", "x" to x.toDouble(), "y" to y.toDouble(), "w" to w.toDouble(), "file" to name)))
        ink.sync(); changed()
    }

    fun addTable() {
        val (pg, x, y) = ink.visibleSpot()
        val cells = JSONArray(List(3) { JSONArray(List(3) { "" }) })
        editing = ItemEdit(pg, jo("id" to newItemId(), "type" to "table", "x" to x.toDouble(), "y" to (Math.floor(y / LINE.toDouble()) * LINE), "w" to 0,
            "cells" to cells, "cols" to JSONArray(listOf(140, 140, 140))))
    }

    fun startRecording() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { micPerm.launch(Manifest.permission.RECORD_AUDIO); return }
        stopPlayback()
        val f = voice.start() ?: return toast("Couldn't start recording")
        val idx = (Core.call(h, "addRecording", jo("file" to f, "ms" to 0, "created" to System.currentTimeMillis())) as? Double)?.toInt() ?: 0
        voice.bind(idx)
        recMs = 0
        changed()
        lifecycleScope.launch { while (voice.recording) { recMs = voice.elapsed(); delay(250) }; recMs = -1 }
    }
    fun stopRecording() {
        val idx = voice.recIndex
        val ms = voice.stop()
        if (h != 0L && idx >= 0) { Core.call(h, "setRecordingLength", jo("index" to idx, "ms" to ms)); changed() }
        recMs = -1
    }
    private val micPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) startRecording() else toast("Microphone permission is needed to record") }

    fun playRecording(idx: Int, from: Long = 0L) {
        val r = recordings.getOrNull(idx) ?: return
        if (!voice.play(idx, r.first, from) { playIdx = -1; ink.playRec = -1; ink.invalidate() }) return toast("Couldn't play that recording")
        playIdx = idx; ink.playRec = idx; playLen = voice.duration().coerceAtLeast(1)
        lifecycleScope.launch { while (voice.playing == idx) { playPos = voice.position(); ink.playMs = playPos.toFloat(); delay(80) } }
    }
    fun stopPlayback() { voice.stopPlay(); playIdx = -1; ink.playRec = -1; ink.invalidate() }

    /* ---------- files ---------- */

    private val pickImage = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let(::addImage) }
    private val pickPdfNew = registerForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> importPdf(u, true) } }
    val pickPdfPicture = registerForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> pdfForPicture(u) } }
    private val pickPdfHere = registerForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> importPdf(u, false) } }
    private val pickBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { u ->
        if (u == null) return@registerForActivityResult
        busy = "Restoring…"
        lifecycleScope.launch {
            val n = withContext(Dispatchers.IO) { try { store.importBackup(contentResolver.openInputStream(u)!!.bufferedReader().readText()) } catch (e: Exception) { -1 } }
            busy = null; refreshList()
            toast(if (n < 0) "That isn't an InkNotes backup" else "Imported $n note${if (n == 1) "" else "s"}")
        }
    }
    private var pendingBackup: String? = null
    private val saveBackup = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { u ->
        val data = pendingBackup; pendingBackup = null
        if (u != null && data != null) lifecycleScope.launch(Dispatchers.IO) { contentResolver.openOutputStream(u)?.use { it.write(data.toByteArray()) } }
    }
    private var pendingPdf: File? = null
    private val savePdf = registerForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { u ->
        val f = pendingPdf; pendingPdf = null
        if (u != null && f != null) lifecycleScope.launch(Dispatchers.IO) { contentResolver.openOutputStream(u)?.use { o -> f.inputStream().use { it.copyTo(o) } } }
    }

    fun backup() { saveNow(); pendingBackup = store.exportBackup(true); saveBackup.launch("InkNotes-backup-${java.text.SimpleDateFormat("yyyy-MM-dd").format(Date())}.json") }

    fun pdfFile(): File? = try {
        saveNow()
        val dir = File(cacheDir, "share").apply { mkdirs() }
        val f = File(dir, (title.ifBlank { "Note" }).replace(Regex("[^A-Za-z0-9 _-]"), "") + ".pdf")
        exportPdf(ink, f); f
    } catch (e: Exception) { toast("Export failed: ${e.message}"); null }

    fun sharePdf() {
        val f = pdfFile() ?: return
        val uri = FileProvider.getUriForFile(this, "com.netadmindave.inknotes2.files", f)
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share PDF"))
    }
    fun savePdfAs() { pendingPdf = pdfFile() ?: return; savePdf.launch(pendingPdf!!.name) }

    fun shareText() {
        val out = StringBuilder()
        if (title.isNotBlank()) out.append("# ").append(title).append("\n\n")
        for (i in 0 until pageCount) {
            val items = (Core.call(h, "page", jo("page" to i)) as? JSONObject)?.optJSONArray("items") ?: continue
            val list = (0 until items.length()).map { items.getJSONObject(it) }.sortedWith(compareBy({ it.optDouble("y") }, { it.optDouble("x") }))
            for (it in list) when (it.optString("type")) {
                "text" -> out.append(it.optString("src")).append("\n\n")
                "math" -> out.append("$$").append(Core.tex(it.optString("src"))).append("$$\n\n")
                "table" -> { val c = it.optJSONArray("cells") ?: JSONArray(); for (r in 0 until c.length()) { val row = c.getJSONArray(r); out.append("| ").append((0 until row.length()).joinToString(" | ") { k -> row.optString(k) }).append(" |\n"); if (r == 0) out.append("|").append(" --- |".repeat(row.length())).append("\n") }; out.append("\n") }
            }
        }
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, out.toString().trim()), "Share text"))
    }

    fun tidyAllText() {
        var n = 0
        val words = JSONArray(store.userWords.toList())
        for (i in 0 until pageCount) {
            val items = (Core.call(h, "page", jo("page" to i)) as? JSONObject)?.optJSONArray("items") ?: continue
            for (k in 0 until items.length()) {
                val it = items.getJSONObject(k)
                if (it.optString("type") != "text") continue
                val r = Core.util("clean", jo("text" to it.optString("src"), "words" to words, "autoMath" to autoMath)) as? JSONObject ?: continue
                if (r.optString("text") != it.optString("src")) { it.put("src", r.optString("text")); Core.call(h, "upsertItem", jo("page" to i, "item" to it, "noCommit" to true)); n++ }
            }
        }
        Core.call(h, "commit")
        val s = (Core.call(h, "smoothAll") as? Double)?.toInt() ?: 0
        ink.sync(); changed()
        toast(if (n == 0 && s == 0) "Already tidy" else "Tidied $n text box${if (n == 1) "" else "es"}" + if (s > 0) " · smoothed handwriting" else "")
    }

    /* ================= UI ================= */

    @Composable
    fun Root() {
        Box(Modifier.fillMaxSize().background(Desk).systemBarsPadding()) {
            Row(Modifier.fillMaxSize()) {
                if (drawer) Sidebar()
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    TopBar()
                    ToolBar()
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        AndroidView(factory = { ink }, modifier = Modifier.fillMaxSize().clipToBounds())
                        if (hasSel) SelectionBar(Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
                        Column(Modifier.align(Alignment.BottomCenter).padding(10.dp)) {
                            if (recMs >= 0) RecordBar()
                            if (playIdx >= 0) PlayBar()
                        }
                        busy?.let { Surface(Modifier.align(Alignment.Center), shape = RoundedCornerShape(12.dp), tonalElevation = 6.dp, shadowElevation = 6.dp) {
                            Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp); Spacer(Modifier.width(12.dp)); Text(it) } } }
                    }
                }
            }
            editing?.let { ItemEditor(it) }
            if (training) Trainer()
            if (pdfChooser) PdfChooser()
            pdfPick?.let { PdfPagePicker(it) }
            cropping?.let { CropDialog(it) }
            review?.let { ReviewDialog(it) }
            if (settings) Settings()
            if (askModel) AlertDialog(onDismissRequest = { askModel = false },
                title = { Text("Handwriting model") },
                text = { Text(when (Recognizer.state) { "unavailable" -> "Handwriting recognition isn't available on this device."; "downloading" -> "Downloading… try again in a moment."; else -> "Converting handwriting needs Google's on-device English model (about 20 MB, downloaded once, then works offline). Download it now?" }) },
                confirmButton = { TextButton(onClick = { askModel = false; lifecycleScope.launch { toast("Downloading handwriting model…"); toast(if (Recognizer.download()) "Model ready" else "Download failed — check the connection") } }) { Text("Download") } },
                dismissButton = { TextButton(onClick = { askModel = false }) { Text("Not now") } })
        }
    }

    @OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
    @Composable
    fun Sidebar() {
        var menuFor by remember { mutableStateOf<String?>(null) }
        Column(Modifier.width(290.dp).fillMaxHeight().background(Color(0xFFF3EEE2)).padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("InkNotes", fontFamily = Hand, fontSize = 34.sp, color = Accent)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { newNote() }) { Icon(Icons.Filled.Add, "New note") }
            }
            OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search notes") }, singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) })
            Spacer(Modifier.height(8.dp))
            val q = search.trim().lowercase()
            LazyColumn(Modifier.weight(1f)) {
                items(notes.filter { q.isEmpty() || it.title.lowercase().contains(q) || it.preview.lowercase().contains(q) }, key = { it.id }) { n ->
                    Box {
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (n.id == noteId) Color(0xFFE6DCC6) else Color.Transparent)
                            .combinedClickable(onClick = { openNote(n.id) }, onLongClick = { menuFor = n.id }).padding(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (n.pinned) Text("📌 ", fontSize = 12.sp)
                                Text(n.title.ifBlank { "Untitled" }, fontFamily = Hand, fontSize = 22.sp, color = InkC, maxLines = 1)
                            }
                            Text(listOf(DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(n.updated)), "${n.pages} pg", n.preview).filter { it.isNotBlank() }.joinToString(" · "),
                                fontSize = 12.sp, color = Color(0xFF7A7263), maxLines = 1)
                        }
                        DropdownMenu(expanded = menuFor == n.id, onDismissRequest = { menuFor = null }) {
                            DropdownMenuItem(text = { Text(if (n.pinned) "Unpin" else "Pin to top") }, onClick = { menuFor = null; saveNow(); store.setPinned(n.id, !n.pinned); if (n.id == noteId) { openNote(n.id) }; refreshList() })
                            DropdownMenuItem(text = { Text("Delete", color = Color(0xFFB91C1C)) }, onClick = { menuFor = null; deleteNote(n.id) })
                        }
                    }
                }
            }
            HorizontalDivider()
            FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { if (pdfAsPicture) startPdfQuestion() else pickPdfNew.launch(arrayOf("application/pdf")) }) { Text("Import PDF") }
                TextButton(onClick = { training = true }) { Text("Train") }
                TextButton(onClick = { backup() }) { Text("Backup") }
                TextButton(onClick = { pickBackup.launch(arrayOf("application/json", "*/*")) }) { Text("Restore") }
                TextButton(onClick = { settings = true }) { Text("Settings") }
            }
        }
    }

    @Composable
    fun TopBar() {
        var insert by remember { mutableStateOf(false) }
        var more by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { drawer = !drawer; store.set("drawer", drawer) }) { Icon(Icons.Filled.Menu, "Notes") }
            var t by remember(noteId) { mutableStateOf(title) }
            BasicTextField(t, { t = it; Core.call(h, "title", jo("title" to it)); changed() }, Modifier.weight(1f).padding(horizontal = 6.dp),
                singleLine = true, textStyle = TextStyle(fontFamily = Hand, fontSize = 28.sp, color = InkC),
                decorationBox = { inner -> Box { if (t.isEmpty()) Text("Title", fontFamily = Hand, fontSize = 28.sp, color = Color(0xFFB8B1A0)); inner() } })
            IconButton(onClick = { op("undo"); ink.refreshSelection() }, enabled = canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, "Undo") }
            IconButton(onClick = { op("redo"); ink.refreshSelection() }, enabled = canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, "Redo") }
            Text("${pageNo + 1}/$pageCount", fontSize = 13.sp, color = Color(0xFF7A7263), modifier = Modifier.padding(horizontal = 6.dp))
            IconButton(onClick = { if (recMs >= 0) stopRecording() else startRecording() }) {
                Icon(if (recMs >= 0) Icons.Filled.Stop else Icons.Filled.Mic, "Record", tint = if (recMs >= 0) Color(0xFFDC2626) else LocalContentColor.current)
            }
            Box {
                IconButton(onClick = { insert = true }) { Icon(Icons.Filled.AddCircleOutline, "Insert") }
                DropdownMenu(insert, { insert = false }) {
                    DropdownMenuItem(text = { Text("Text box") }, onClick = { insert = false; val (p, x, y) = ink.visibleSpot(); ink.onPlaceText(p, x, y) })
                    DropdownMenuItem(text = { Text("Formula") }, onClick = { insert = false; val (p, x, y) = ink.visibleSpot(); editing = ItemEdit(p, jo("id" to newItemId(), "type" to "math", "x" to x.toDouble(), "y" to y.toDouble(), "w" to 0, "src" to "")) })
                    DropdownMenuItem(text = { Text("Table") }, onClick = { insert = false; addTable() })
                    DropdownMenuItem(text = { Text("Picture") }, onClick = { insert = false; pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                    DropdownMenuItem(text = { Text("Question from PDF (one page, crop)") }, onClick = { insert = false; startPdfQuestion() })
                    DropdownMenuItem(text = { Text("PDF pages to write on") }, onClick = { insert = false; pickPdfHere.launch(arrayOf("application/pdf")) })
                    DropdownMenuItem(text = { Text("Voice recording") }, onClick = { insert = false; startRecording() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("New page after this one") }, onClick = { insert = false; op("addPage", jo("at" to pageNo + 1, "now" to System.currentTimeMillis())); ink.scrollToPage(pageNo + 1) })
                    DropdownMenuItem(text = { Text("New page at the end") }, onClick = { insert = false; op("addPage", jo("at" to 9999, "now" to System.currentTimeMillis())); ink.scrollToPage(pageCount - 1) })
                }
            }
            Box {
                IconButton(onClick = { more = true }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(more, { more = false }) {
                    DropdownMenuItem(text = { Text("Tidy text & smooth handwriting") }, onClick = { more = false; tidyAllText() })
                    DropdownMenuItem(text = { Text("Select everything on this page") }, onClick = { more = false; tool = "lasso"; pushTool(); Core.call(h, "selectAll", jo("page" to pageNo)); ink.refreshSelection() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Share as PDF") }, onClick = { more = false; sharePdf() })
                    DropdownMenuItem(text = { Text("Save PDF to…") }, onClick = { more = false; savePdfAs() })
                    DropdownMenuItem(text = { Text("Share converted text") }, onClick = { more = false; shareText() })
                    HorizontalDivider()
                    for ((k, l) in listOf("lined" to "Lined paper", "grid" to "Grid paper", "dot" to "Dotted paper", "plain" to "Plain paper"))
                        DropdownMenuItem(text = { Text(l) }, onClick = { more = false; op("paper", jo("paper" to k)); store.set("paper", k); ink.sync(true) })
                    for ((k, l) in listOf("letter" to "Letter 8.5×11", "a4" to "A4"))
                        DropdownMenuItem(text = { Text(l) }, onClick = { more = false; op("size", jo("size" to k)); store.set("size", k); ink.sync(true) })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Move page up") }, enabled = pageNo > 0, onClick = { more = false; op("movePage", jo("from" to pageNo, "to" to pageNo - 1)); ink.sync(true); ink.scrollToPage(pageNo - 1) })
                    DropdownMenuItem(text = { Text("Move page down") }, enabled = pageNo < pageCount - 1, onClick = { more = false; op("movePage", jo("from" to pageNo, "to" to pageNo + 1)); ink.sync(true); ink.scrollToPage(pageNo + 1) })
                    DropdownMenuItem(text = { Text("Delete this page", color = Color(0xFFB91C1C)) }, enabled = pageCount > 1, onClick = { more = false; op("removePage", jo("page" to pageNo)); ink.sync(true) })
                }
            }
        }
    }

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    fun ToolBar() {
        var sizePop by remember { mutableStateOf(false) }
        var eraserPop by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val tools = listOf("pen" to "✒️", "pencil" to "✏️", "hl" to "🖍️", "eraser" to "🧽", "lasso" to "➰", "text" to "🅣")
            for ((k, g) in tools) {
                Box {
                    ToolChip(g, tool == k) {
                        if (tool == k && k == "eraser") eraserPop = true
                        else if (tool == k && k in listOf("pen", "pencil", "hl")) sizePop = true
                        else { tool = k; pushTool() }
                    }
                    if (k == "eraser") DropdownMenu(eraserPop, { eraserPop = false }) {
                        Row(Modifier.padding(8.dp)) { for ((r, l) in ERASER_SIZES) FilterChip(eraserSize == r, { eraserSize = r; pushTool() }, { Text(l) }, Modifier.padding(2.dp)) }
                        Row(Modifier.padding(8.dp)) {
                            FilterChip(!eraserWhole, { eraserWhole = false; pushTool() }, { Text("Erase under pen") }, Modifier.padding(2.dp))
                            FilterChip(eraserWhole, { eraserWhole = true; pushTool() }, { Text("Whole strokes") }, Modifier.padding(2.dp))
                        }
                    }
                    if (k == tool && k in listOf("pen", "pencil", "hl")) DropdownMenu(sizePop, { sizePop = false }) {
                        Column(Modifier.width(280.dp).padding(12.dp)) {
                            Text("Thickness ${"%.1f".format(size)}")
                            Slider(size, { size = (Math.round(it * 4) / 4f) }, valueRange = 0.5f..12f, onValueChangeFinished = { pushTool() })
                            Row { for (s in listOf(1f, 1.5f, 2.5f, 4f, 7f)) FilterChip(size == s, { size = s; pushTool() }, { Text("$s") }, Modifier.padding(2.dp)) }
                            Text("Line", Modifier.padding(top = 8.dp))
                            Row {
                                for ((d, l) in listOf("" to "Solid", "dash" to "Dashed", "dot" to "Dotted")) FilterChip(dash == d, { dash = d; pushTool() }, { Text(l) }, Modifier.padding(2.dp))
                            }
                        }
                    }
                }
            }
            VerticalDivider(Modifier.height(28.dp).padding(horizontal = 6.dp))
            for (c in COLORS) {
                val col = Color(android.graphics.Color.parseColor(c))
                Box(Modifier.padding(3.dp).size(if (color == c) 30.dp else 24.dp).clip(CircleShape).background(col)
                    .border(if (color == c) 3.dp else 0.dp, Color.White, CircleShape).clickable {
                        color = c; if (tool !in listOf("pen", "pencil", "hl")) tool = "pen"; pushTool()
                        if (hasSel) op("recolorSel", jo("color" to c))
                    })
            }
            VerticalDivider(Modifier.height(28.dp).padding(horizontal = 6.dp))
            ToolChip("◇ Shapes", shapes) { shapes = !shapes; pushTool(); toast(if (shapes) "Lines and shapes straighten automatically (or pause at the end of a stroke)" else "Pause at the end of a stroke to straighten it") }
            ToolChip("☝ Finger draws", fingerDraws) { fingerDraws = !fingerDraws; ink.fingerDraws = fingerDraws; store.set("fingerDraws", fingerDraws) }
            ToolChip(if (lock) "🔒 2-finger scroll" else "🔓 1-finger scroll", lock) { lock = !lock; ink.lock = lock; store.set("lock", lock) }
            if (recordings.isNotEmpty()) {
                VerticalDivider(Modifier.height(28.dp).padding(horizontal = 6.dp))
                recordings.forEachIndexed { i, r ->
                    ToolChip("▶ ${i + 1} · ${fmt(r.second)}", playIdx == i) { if (playIdx == i) stopPlayback() else playRecording(i) }
                }
            }
        }
    }

    @Composable
    fun ToolChip(label: String, on: Boolean, onClick: () -> Unit) {
        Box(Modifier.padding(2.dp).clip(RoundedCornerShape(10.dp)).background(if (on) Color(0xFFDCCFEA) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp)) { Text(label, fontSize = 16.sp) }
    }

    @Composable
    fun SelectionBar(m: Modifier) {
        var conv by remember { mutableStateOf(false) }
        Surface(m, shape = RoundedCornerShape(14.dp), shadowElevation = 8.dp, tonalElevation = 2.dp) {
            Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    TextButton(onClick = { conv = true }) { Text("⇄ Convert") }
                    DropdownMenu(conv, { conv = false }) {
                        DropdownMenuItem(text = { Text("Auto (text + formulas)") }, onClick = { conv = false; convert("auto") })
                        DropdownMenuItem(text = { Text("Text") }, onClick = { conv = false; convert("text") })
                        DropdownMenuItem(text = { Text("Formula") }, onClick = { conv = false; convert("math") })
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { keepInk = !keepInk }.padding(horizontal = 4.dp)) {
                    Checkbox(keepInk, { keepInk = it }); Text("Keep ink", fontSize = 13.sp)
                }
                TextButton(onClick = { op("smoothSel"); ink.refreshSelection() }) { Text("Smooth") }
                val sel = (Core.call(h, "meta") as? JSONObject)?.optJSONObject("sel")
                val oneItem = sel?.optJSONArray("items")?.takeIf { it.length() == 1 && sel.optInt("strokes") == 0 }?.getString(0)
                if (oneItem != null) TextButton(onClick = { ink.onItemTap(sel.optInt("page"), oneItem) }) { Text("Edit") }
                TextButton(onClick = { op("deleteSel"); ink.refreshSelection() }) { Text("Delete", color = Color(0xFFB91C1C)) }
                IconButton(onClick = { ink.clearSelection() }) { Icon(Icons.Filled.Close, "Done") }
            }
        }
    }

    fun fmt(ms: Long): String { val s = ms / 1000; return "%d:%02d".format(s / 60, s % 60) }

    @Composable
    fun RecordBar() {
        Surface(shape = RoundedCornerShape(24.dp), color = Color(0xFFFEE2E2), shadowElevation = 4.dp) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(Color(0xFFDC2626)))
                Text("  Recording ${fmt(recMs)} — what you write now is synced to the audio", fontSize = 14.sp)
                TextButton(onClick = { stopRecording() }) { Text("Stop") }
            }
        }
    }

    @Composable
    fun PlayBar() {
        Surface(shape = RoundedCornerShape(24.dp), shadowElevation = 4.dp) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp).widthIn(max = 560.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { voice.pause() }) { Icon(if (voice.paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, "Pause") }
                Text(fmt(playPos), fontSize = 13.sp)
                Slider(playPos.toFloat().coerceIn(0f, playLen.toFloat()), { playPos = it.toLong(); voice.seek(it.toLong()); ink.playMs = it }, Modifier.weight(1f).padding(horizontal = 8.dp), valueRange = 0f..playLen.toFloat())
                Text(fmt(playLen), fontSize = 13.sp)
                IconButton(onClick = { stopPlayback() }) { Icon(Icons.Filled.Close, "Stop") }
            }
        }
    }

    @Composable
    fun ItemEditor(e: ItemEdit) {
        val kind0 = e.item.optString("type")
        var kind by remember(e) { mutableStateOf(kind0) }
        var src by remember(e) { mutableStateOf(e.item.optString("src")) }
        var cells by remember(e) {
            val a = e.item.optJSONArray("cells")
            val init: List<List<String>> = if (a == null) emptyList() else List(a.length()) { r -> val row = a.getJSONArray(r); List(row.length()) { k -> row.optString(k) } }
            mutableStateOf(init)
        }
        var unknown by remember(e) { mutableStateOf(mapOf<String, List<String>>()) }
        val isNew = Core.call(h, "page", jo("page" to e.page)).let { p -> (p as? JSONObject)?.optJSONArray("items")?.let { a -> (0 until a.length()).none { a.getJSONObject(it).optString("id") == e.item.optString("id") } } ?: true }
        fun close() { editing = null }
        fun save() {
            val it = JSONObject(e.item.toString())
            it.put("type", kind)
            if (kind == "table") it.put("cells", JSONArray(cells.map { r -> JSONArray(r) })).put("cols", JSONArray(List(cells.firstOrNull()?.size ?: 0) { k -> e.item.optJSONArray("cols")?.optDouble(k, 140.0) ?: 140.0 }))
            else it.put("src", src)
            if (kind != "table" && kind != "image" && (src.isBlank() || (kind == "math" && srcToLatex(src).isBlank()))) { if (!isNew) op("removeItem", jo("id" to it.optString("id"))) }
            else { Core.call(h, "upsertItem", jo("page" to e.page, "item" to it)); ink.sync(); changed() }
            close()
        }
        Dialog(onDismissRequest = { save() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.widthIn(max = 720.dp).fillMaxWidth(0.92f), shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
                    if (kind == "text" || kind == "math") Row {
                        FilterChip(kind == "text", { if (kind == "math") src = src.removePrefix("\\[").removeSuffix("\\]"); kind = "text" }, { Text("Text") }, Modifier.padding(end = 6.dp))
                        FilterChip(kind == "math", { kind = "math" }, { Text("Formula") })
                    }
                    when (kind) {
                        "table" -> {
                            cells.forEachIndexed { r, row ->
                                Row {
                                    row.forEachIndexed { k, v ->
                                        OutlinedTextField(v, { nv -> cells = cells.mapIndexed { rr, rw -> if (rr == r) rw.mapIndexed { kk, x -> if (kk == k) nv else x } else rw } },
                                            Modifier.weight(1f).padding(2.dp), textStyle = TextStyle(fontFamily = Hand, fontSize = 20.sp))
                                    }
                                }
                            }
                            Row {
                                TextButton(onClick = { cells = cells + listOf(List(cells.firstOrNull()?.size ?: 1) { "" }) }) { Text("+ Row") }
                                TextButton(onClick = { cells = cells.map { it + "" } }) { Text("+ Column") }
                                TextButton(onClick = { if (cells.size > 1) cells = cells.dropLast(1) }) { Text("− Row") }
                                TextButton(onClick = { if ((cells.firstOrNull()?.size ?: 0) > 1) cells = cells.map { it.dropLast(1) } }) { Text("− Column") }
                            }
                        }
                        "image" -> Text("Picture — drag it with the lasso to move it.", Modifier.padding(8.dp))
                        else -> {
                            if (kind == "math") {
                                val start = remember(e, kind) { srcToLatex(src) }
                                MathField(start, Modifier.fillMaxWidth().height(430.dp)) { t -> src = latexToSrc(t) }
                            } else {
                                OutlinedTextField(src, { src = it; unknown = emptyMap() }, Modifier.fillMaxWidth().heightIn(min = 120.dp),
                                    textStyle = TextStyle(fontFamily = Hand, fontSize = 24.sp),
                                    placeholder = { Text("Type here — formulas like x^2 + 1 = y render as math") })
                                if (src.isNotBlank()) MathPreview(src, false)
                            }
                            if (kind == "text") Row {
                                TextButton(onClick = {
                                    val r = Core.util("clean", jo("text" to src, "words" to JSONArray(store.userWords.toList()), "autoMath" to autoMath)) as? JSONObject
                                    if (r != null) {
                                        src = r.optString("text")
                                        val u = r.optJSONObject("unknown")
                                        unknown = u?.keys()?.asSequence()?.associate { k -> k to (u.getJSONArray(k).let { a -> List(a.length()) { a.getString(it) } }) } ?: emptyMap()
                                        toast(if ((r.optJSONArray("changes")?.length() ?: 0) == 0) "Looks tidy" else "Tidied")
                                    }
                                }) { Text("Clean up") }
                            }
                            for ((w, sug) in unknown) Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("“$w”: ", fontSize = 14.sp)
                                for (s in sug) TextButton(onClick = { src = src.replace(Regex("\\b${Regex.escape(w)}\\b"), s); unknown = unknown - w }) { Text(s) }
                                TextButton(onClick = { store.userWords = store.userWords + w.lowercase(); unknown = unknown - w; ink.relayoutItems() }) { Text("Add to dictionary") }
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                        if (!isNew) TextButton(onClick = { op("removeItem", jo("id" to e.item.optString("id"))); close() }) { Text("Delete", color = Color(0xFFB91C1C)) }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { close() }) { Text("Cancel") }
                        Button(onClick = { save() }) { Text("Done") }
                    }
                }
            }
        }
    }

    @Composable
    fun MathPreview(src: String, math: Boolean) {
        AndroidView(factory = { ctx -> android.widget.ImageView(ctx) }, update = { iv ->
            if (math) iv.setImageDrawable(render.math(src, 64f))
            else {
                val l = render.layoutText(src, 900f)
                val bm = android.graphics.Bitmap.createBitmap(maxOf(1, l.w.toInt() + 8), maxOf(1, l.h.toInt() + 8), android.graphics.Bitmap.Config.ARGB_8888)
                l.draw(android.graphics.Canvas(bm)); iv.setImageBitmap(bm)
            }
            iv.adjustViewBounds = true; iv.scaleType = android.widget.ImageView.ScaleType.FIT_START
        }, modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).padding(vertical = 8.dp).background(Paper))
    }

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    fun MathKeys(onKey: (String) -> Unit) {
        val keys = listOf("^" to "^", "_" to "_", "frac" to "()/()", "√" to "sqrt()", "∫" to "int_()^() ", "∑" to "sum_()^() ", "∞" to "oo", "π" to "pi",
            "θ" to "theta", "α" to "alpha", "β" to "beta", "λ" to "lambda", "μ" to "mu", "Δ" to "Delta", "∂" to "del", "±" to "+-", "×" to "xx", "÷" to "-:",
            "≤" to "<=", "≥" to ">=", "≠" to "!=", "≈" to "~~", "→" to "->", "°" to "deg")
        FlowRow { for ((l, v) in keys) OutlinedButton(onClick = { onKey(v) }, Modifier.padding(2.dp), contentPadding = PaddingValues(horizontal = 8.dp)) { Text(l) } }
    }

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    fun Trainer() {
        val counts = remember { mutableStateOf((Core.utilRaw("trainCount", "null") as? JSONArray)?.let { a -> List(a.length()) { a.getJSONArray(it).let { p -> p.getString(0) to p.getInt(1) } } } ?: emptyList()) }
        var idx by remember { mutableStateOf(counts.value.indexOfFirst { it.second < 3 }.coerceAtLeast(0)) }
        val pad = remember { TrainPad(this) }
        Dialog(onDismissRequest = { training = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.widthIn(max = 640.dp).fillMaxWidth(0.94f), shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Teach InkNotes your handwriting", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("Write the symbol below the way you normally do. Three samples each is plenty; formulas use them to fix misreadings.", fontSize = 13.sp, color = Color(0xFF6B6B6B))
                    val cur = counts.value.getOrNull(idx)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 10.dp)) {
                        Text(cur?.first ?: "", fontSize = 56.sp, modifier = Modifier.width(110.dp))
                        Text("${cur?.second ?: 0} sample(s) saved", fontSize = 14.sp)
                    }
                    AndroidView(factory = { pad }, modifier = Modifier.fillMaxWidth().height(260.dp).border(1.dp, Color(0xFFD8D0BD)))
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { pad.clear() }) { Text("Clear") }
                        TextButton(onClick = { pad.clear(); idx = (idx + 1) % counts.value.size }) { Text("Skip") }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { training = false }) { Text("Close") }
                        Button(onClick = { if (!pad.empty && cur != null) {
                            Core.util("trainAdd", jo("sym" to cur.first, "strokes" to pad.json()))
                            (Core.utilRaw("trainSave", "null") as? JSONObject)?.let { store.set("hwSamples", it.toString()) }
                            counts.value = counts.value.map { if (it.first == cur.first) it.first to it.second + 1 else it }
                            pad.clear()
                            val next = counts.value.indexOfFirst { it.second < 3 }
                            if (next >= 0) idx = next else toast("All symbols have 3 samples — keep adding any that get misread")
                        } }) { Text("Save sample") }
                    }
                    FlowRow(Modifier.padding(top = 8.dp)) {
                        counts.value.forEachIndexed { i, (s, n) ->
                            Box(Modifier.padding(2.dp).clip(RoundedCornerShape(6.dp)).background(if (i == idx) Color(0xFFDCCFEA) else if (n >= 3) Color(0xFFDCFCE7) else Color(0xFFF3F4F6))
                                .clickable { pad.clear(); idx = i }.padding(horizontal = 8.dp, vertical = 4.dp)) { Text(s, fontSize = 16.sp) }
                        }
                    }
                    TextButton(onClick = { Core.util("trainClear", jo("sym" to "")); store.set("hwSamples", "{}"); counts.value = counts.value.map { it.first to 0 } }) { Text("Forget all samples", color = Color(0xFFB91C1C)) }
                }
            }
        }
    }

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    fun Settings() {
        Dialog(onDismissRequest = { settings = false }) {
            Surface(shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
                    Text("Settings", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("Handwriting font", Modifier.padding(top = 12.dp))
                    FlowRow {
                        for ((k, l, f) in listOf(Triple("caveat", "Caveat", R.font.caveat), Triple("kalam", "Kalam", R.font.kalam), Triple("patrick", "Patrick Hand", R.font.patrick_hand), Triple("shadows", "Shadows", R.font.shadows)))
                            FilterChip(font == k, { font = k; render.font = k; store.set("font", k); ink.relayoutItems() }, { Text(l, fontFamily = FontFamily(Font(f)), fontSize = 18.sp) }, Modifier.padding(2.dp))
                    }
                    Text("Text size ${(textScale * 100).toInt()}%", Modifier.padding(top = 12.dp))
                    Slider(textScale, { textScale = it }, valueRange = 0.5f..1.3f, onValueChangeFinished = { render.textScale = textScale; store.set("textScale", textScale); ink.relayoutItems() })
                    Row(verticalAlignment = Alignment.CenterVertically) { Switch(autoMath, { autoMath = it; render.autoMath = it; store.set("autoMath", it); ink.relayoutItems() }); Text("  Show formulas inside text as math") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Switch(pdfAsPicture, { pdfAsPicture = it; store.set("pdfAsPicture", it) }); Text("  Import PDF asks for one page and adds it as a croppable picture") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Switch(whitePaper, { whitePaper = it; ink.whitePaper = it; store.set("whitePaper", it); ink.invalidate() }); Text("  White paper") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Switch(fingerDraws, { fingerDraws = it; ink.fingerDraws = it; store.set("fingerDraws", it) }); Text("  Finger writes (for phones)") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Switch(lock, { lock = it; ink.lock = it; store.set("lock", it) }); Text("  Two fingers to move the page") }
                    Text("Handwriting model: " + when (Recognizer.state) { "ready" -> "ready (offline)"; "missing" -> "not downloaded"; "downloading" -> "downloading…"; "unavailable" -> "unavailable"; else -> "checking" }, Modifier.padding(top = 12.dp))
                    if (Recognizer.state == "missing") TextButton(onClick = { lifecycleScope.launch { toast(if (Recognizer.download()) "Model ready" else "Download failed") } }) { Text("Download now") }
                    Text("Personal dictionary: ${store.userWords.size} words", Modifier.padding(top = 8.dp), fontSize = 13.sp)
                    Text("InkNotes · Rust engine + native UI", Modifier.padding(top = 12.dp), fontSize = 12.sp, color = Color(0xFF8A8A8A))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Button(onClick = { settings = false }) { Text("Done") } }
                }
            }
        }
    }
}
