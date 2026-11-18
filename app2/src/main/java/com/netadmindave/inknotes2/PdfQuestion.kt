package com.netadmindave.inknotes2

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.abs
import kotlin.math.min

/** A PDF whose page the user is choosing. */
class PdfPick(val file: String, val name: String, val pages: Int)

/* ---------- recent PDFs ---------- */

fun MainActivity.recentPdfs(): List<Pair<String, String>> = try {
    val a = JSONArray(store.pref("recentPdfs", "[]"))
    (0 until a.length()).map { a.getJSONObject(it).let { o -> o.getString("file") to o.optString("name", "PDF") } }.filter { store.media(it.first).exists() }
} catch (e: Exception) { emptyList() }

fun MainActivity.rememberPdf(file: String, name: String) {
    val list = listOf(file to name) + recentPdfs().filter { it.first != file }
    store.set("recentPdfs", JSONArray(list.take(8).map { JSONObject().put("file", it.first).put("name", it.second) }).toString())
}

/** Open the page chooser for a PDF already in media/. */
fun MainActivity.choosePage(file: String, name: String) {
    lifecycleScope.launch {
        val n = withContext(Dispatchers.IO) { render.pdfInfo(store.media(file)).size }
        if (n == 0) { toast("Couldn't open that PDF"); return@launch }
        rememberPdf(file, name)
        pdfPick = PdfPick(file, name, n)
    }
}

/** Render one PDF page to a picture on the current page, then open the cropper. */
fun MainActivity.insertPdfPage(p: PdfPick, page: Int) {
    pdfPick = null
    store.set("pdfLastPage:${p.file}", page.toString())
    busy = "Adding page ${page + 1}…"
    lifecycleScope.launch {
        val name = withContext(Dispatchers.IO) {
            val bm = render.pdfPage(store.media(p.file), page, 1700) ?: return@withContext null
            val n = "q${System.currentTimeMillis()}.png"
            store.media(n).outputStream().use { bm.compress(Bitmap.CompressFormat.PNG, 100, it) }
            n
        }
        busy = null
        if (name == null) { toast("Couldn't render that page"); return@launch }
        val (pg, _, y) = ink.visibleSpot()
        val w = ink.pageSize(pg).first - MARGIN_L - MARGIN_R
        val item = jo("id" to newItemId(), "type" to "image", "x" to MARGIN_L.toDouble(), "y" to y.toDouble(), "w" to w.toDouble(), "file" to name)
        Core.call(h, "upsertItem", jo("page" to pg, "item" to item))
        ink.sync(); changed()
        cropping = ItemEdit(pg, item)
    }
}

/* ---------- dialogs ---------- */

@Composable
fun MainActivity.PdfChooser() {
    val recent = remember { recentPdfs() }
    AlertDialog(onDismissRequest = { pdfChooser = false },
        title = { Text("Question from a PDF") },
        text = {
            LazyColumn {
                items(recent) { (file, name) ->
                    Text("📄 $name", Modifier.fillMaxWidth().clickable { pdfChooser = false; choosePage(file, name) }.padding(vertical = 12.dp), fontSize = 16.sp)
                }
            }
        },
        confirmButton = { TextButton(onClick = { pdfChooser = false; pickPdfPicture.launch(arrayOf("application/pdf")) }) { Text("Choose another PDF…") } },
        dismissButton = { TextButton(onClick = { pdfChooser = false }) { Text("Cancel") } })
}

@Composable
fun MainActivity.PdfPagePicker(p: PdfPick) {
    val last = remember(p) { store.pref("pdfLastPage:${p.file}", "").toIntOrNull() ?: 0 }
    val grid = rememberLazyGridState(initialFirstVisibleItemIndex = last.coerceIn(0, p.pages - 1))
    Dialog(onDismissRequest = { pdfPick = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.94f).fillMaxHeight(0.9f), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Which page?", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text("${p.name} · ${p.pages} pages — it goes in as a picture you can crop", fontSize = 13.sp, color = Color(0xFF6B6B6B))
                    }
                    TextButton(onClick = { pdfPick = null }) { Text("Cancel") }
                }
                LazyVerticalGrid(GridCells.Adaptive(150.dp), Modifier.fillMaxSize().padding(top = 8.dp), state = grid) {
                    items(p.pages) { i ->
                        var thumb by remember(p.file, i) { mutableStateOf<ImageBitmap?>(null) }
                        LaunchedEffect(p.file, i) { thumb = withContext(Dispatchers.IO) { render.pdfPage(store.media(p.file), i, 320)?.asImageBitmap() } }
                        Column(Modifier.padding(6.dp).clickable { insertPdfPage(p, i) }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(Modifier.fillMaxWidth().aspectRatio(0.773f).background(Color.White)
                                .border(if (i == last) 3.dp else 1.dp, if (i == last) Accent else Color(0xFFD8D0BD))) {
                                thumb?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
                                    ?: CircularProgressIndicator(Modifier.align(Alignment.Center).size(20.dp), strokeWidth = 2.dp)
                            }
                            Text("${i + 1}", fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}


/** Crop (and resize) a picture: drag corners/edges, drag inside to move the frame. */
@Composable
fun MainActivity.CropDialog(e: ItemEdit) {
    val bm = remember(e) { render.image(store.media(e.item.optString("file"))) }
    if (bm == null) { cropping = null; return }
    val img = remember(bm) { bm.asImageBitmap() }
    val c0 = remember(e) { cropOf(e.item) }
    var crop by remember(e) { mutableStateOf(c0.toList()) }
    val pageW = ink.pageSize(e.page).first
    // width the whole picture would have at the current scale; cropping keeps that scale
    var fullW by remember(e) { mutableStateOf(e.item.optDouble("w", 360.0).toFloat() / (c0[2] - c0[0])) }
    var grab by remember { mutableStateOf(0) }
    fun save() {
        val it = JSONObject(e.item.toString())
        it.put("crop", JSONArray(crop.map { v -> v.toDouble() }))
        val w = (fullW * (crop[2] - crop[0])).coerceIn(40f, pageW)
        it.put("w", w.toDouble()); it.remove("h")
        if (it.optDouble("x") + w > pageW) it.put("x", (pageW - w).coerceAtLeast(0f).toDouble())
        Core.call(h, "upsertItem", jo("page" to e.page, "item" to it))
        ink.sync(); changed(); cropping = null
    }
    Dialog(onDismissRequest = { cropping = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.94f), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text("Crop to the question — drag the corners or edges, drag inside to move", fontSize = 14.sp)
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(vertical = 8.dp).background(Color(0xFF3A3A3A))) {
                    val bw = constraints.maxWidth.toFloat(); val bh = constraints.maxHeight.toFloat()
                    val s = min(bw / bm.width, bh / bm.height)
                    val dw = bm.width * s; val dh = bm.height * s
                    val ox = (bw - dw) / 2; val oy = (bh - dh) / 2
                    Canvas(Modifier.fillMaxSize().pointerInput(dw, dh) {
                        val tol = 34.dp.toPx()
                        detectDragGestures(
                            onDragStart = { o ->
                                val x0 = ox + crop[0] * dw; val y0 = oy + crop[1] * dh; val x1 = ox + crop[2] * dw; val y1 = oy + crop[3] * dh
                                var g = 0
                                val nearY = o.y > y0 - tol && o.y < y1 + tol; val nearX = o.x > x0 - tol && o.x < x1 + tol
                                if (nearY && abs(o.x - x0) < tol) g = g or 1
                                if (nearY && abs(o.x - x1) < tol) g = g or 4
                                if (nearX && abs(o.y - y0) < tol) g = g or 2
                                if (nearX && abs(o.y - y1) < tol) g = g or 8
                                if (g == 0 && o.x in x0..x1 && o.y in y0..y1) g = 15
                                grab = g
                            },
                            onDrag = { ch, d ->
                                ch.consume()
                                val dx = d.x / dw; val dy = d.y / dh
                                var (l, t, r, b) = crop
                                val min = 0.03f
                                if (grab == 15) {
                                    val mx = dx.coerceIn(-l, 1f - r); val my = dy.coerceIn(-t, 1f - b)
                                    l += mx; r += mx; t += my; b += my
                                } else {
                                    if (grab and 1 != 0) l = (l + dx).coerceIn(0f, r - min)
                                    if (grab and 4 != 0) r = (r + dx).coerceIn(l + min, 1f)
                                    if (grab and 2 != 0) t = (t + dy).coerceIn(0f, b - min)
                                    if (grab and 8 != 0) b = (b + dy).coerceIn(t + min, 1f)
                                }
                                crop = listOf(l, t, r, b)
                            })
                    }) {
                        drawImage(img, dstOffset = IntOffset(ox.toInt(), oy.toInt()), dstSize = IntSize(dw.toInt(), dh.toInt()))
                        val x0 = ox + crop[0] * dw; val y0 = oy + crop[1] * dh; val x1 = ox + crop[2] * dw; val y1 = oy + crop[3] * dh
                        val dim = Color(0x99000000)
                        drawRect(dim, Offset(ox, oy), Size(dw, y0 - oy))
                        drawRect(dim, Offset(ox, y1), Size(dw, oy + dh - y1))
                        drawRect(dim, Offset(ox, y0), Size(x0 - ox, y1 - y0))
                        drawRect(dim, Offset(x1, y0), Size(ox + dw - x1, y1 - y0))
                        drawRect(Color.White, Offset(x0, y0), Size(x1 - x0, y1 - y0), style = Stroke(2.dp.toPx()))
                        val hl = 18.dp.toPx(); val hw = 5.dp.toPx()
                        for ((cx, cy) in listOf(x0 to y0, x1 to y0, x0 to y1, x1 to y1)) {
                            val sx = if (cx == x0) 1f else -1f; val sy = if (cy == y0) 1f else -1f
                            drawLine(Color.White, Offset(cx, cy), Offset(cx + sx * hl, cy), hw)
                            drawLine(Color.White, Offset(cx, cy), Offset(cx, cy + sy * hl), hw)
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Size", fontSize = 14.sp)
                    Slider(fullW, { fullW = it }, Modifier.weight(1f).padding(horizontal = 10.dp), valueRange = 200f..(pageW * 2.5f))
                    Text("${(fullW * (crop[2] - crop[0])).toInt()} px wide", fontSize = 13.sp)
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { crop = listOf(0f, 0f, 1f, 1f) }) { Text("Reset") }
                    TextButton(onClick = { op("removeItem", jo("id" to e.item.optString("id"))); cropping = null }) { Text("Delete", color = Color(0xFFB91C1C)) }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { cropping = null }) { Text("Cancel") }
                    Button(onClick = { save() }) { Text("Done") }
                }
            }
        }
    }
}
