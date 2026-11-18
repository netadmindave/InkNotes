package com.netadmindave.inknotes2

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import org.json.JSONArray
import org.json.JSONObject

val FONT_CHOICES: List<Triple<String, String, FontFamily>> = listOf(
    Triple("default", "Note default", FontFamily.Default),
    Triple("caveat", "Caveat", FontFamily(Font(R.font.caveat))),
    Triple("kalam", "Kalam", FontFamily(Font(R.font.kalam))),
    Triple("patrick", "Patrick Hand", FontFamily(Font(R.font.patrick_hand))),
    Triple("shadows", "Shadows", FontFamily(Font(R.font.shadows))),
    Triple("sans", "Sans", FontFamily.SansSerif),
    Triple("serif", "Serif", FontFamily.Serif),
    Triple("mono", "Mono", FontFamily.Monospace),
)

private fun JSONObject.with(k: String, v: Any?): JSONObject = JSONObject(toString()).apply { if (v == null) remove(k) else put(k, v) }

/** Font, size, colour, bold / italic / underline and alignment for text boxes. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TextStyleBar(style: JSONObject, onChange: (JSONObject) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text("Font", fontSize = 13.sp, color = Color(0xFF6B6B6B))
        val font = style.optString("font", "default").ifEmpty { "default" }
        FlowRow {
            FONT_CHOICES.forEach { (k, l, fam) ->
                FilterChip(font == k, { onChange(style.with("font", if (k == "default") null else k)) }, { Text(l, fontFamily = fam, fontSize = 17.sp) }, Modifier.padding(2.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val size = style.optDouble("size", 1.0).toFloat()
            Text("Size ${(size * 100).toInt()}%", fontSize = 13.sp, modifier = Modifier.width(90.dp))
            Slider(size, { onChange(style.with("size", (Math.round(it * 20) / 20.0))) }, Modifier.weight(1f), valueRange = 0.5f..3f)
        }
        FlowRow(verticalArrangement = Arrangement.Center) {
            val bold = style.optBoolean("bold"); val italic = style.optBoolean("italic"); val under = style.optBoolean("underline")
            FilterChip(bold, { onChange(style.with("bold", if (bold) null else true)) }, { Text("B", fontWeight = FontWeight.Bold) }, Modifier.padding(2.dp))
            FilterChip(italic, { onChange(style.with("italic", if (italic) null else true)) }, { Text("I", fontStyle = FontStyle.Italic) }, Modifier.padding(2.dp))
            FilterChip(under, { onChange(style.with("underline", if (under) null else true)) }, { Text("U", textDecoration = TextDecoration.Underline) }, Modifier.padding(2.dp))
            Spacer(Modifier.width(10.dp))
            val align = style.optString("align", "")
            for ((k, l) in listOf("" to "⇤ Left", "center" to "↔ Center", "right" to "⇥ Right"))
                FilterChip(align == k, { onChange(style.with("align", k.ifEmpty { null })) }, { Text(l) }, Modifier.padding(2.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            Text("Colour", fontSize = 13.sp, modifier = Modifier.width(60.dp))
            val cur = style.optString("color", "")
            Box(Modifier.padding(3.dp).size(28.dp).clip(CircleShape).border(if (cur.isEmpty()) 3.dp else 1.dp, if (cur.isEmpty()) Accent else Color.Gray, CircleShape)
                .clickable { onChange(style.with("color", null)) }, contentAlignment = Alignment.Center) { Text("A", fontSize = 13.sp) }
            for (c in COLORS) {
                Box(Modifier.padding(3.dp).size(if (cur == c) 30.dp else 24.dp).clip(CircleShape).background(Color(android.graphics.Color.parseColor(c)))
                    .border(if (cur == c) 3.dp else 0.dp, Color.White, CircleShape).clickable { onChange(style.with("color", c)) })
            }
        }
    }
}

/** Restyle every text box in the current selection. */
@Composable
fun MainActivity.StyleDialog() {
    val sel = remember { (Core.call(h, "meta") as? JSONObject)?.optJSONObject("sel") }
    val page = sel?.optInt("page") ?: 0
    val ids = remember { sel?.optJSONArray("items")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet() }
    val texts = remember {
        val arr = (Core.call(h, "page", jo("page" to page)) as? JSONObject)?.optJSONArray("items") ?: JSONArray()
        (0 until arr.length()).map { arr.getJSONObject(it) }.filter { it.optString("id") in ids && it.optString("type") == "text" }
    }
    var style by remember { mutableStateOf(texts.firstOrNull()?.optJSONObject("style") ?: JSONObject()) }
    Dialog(onDismissRequest = { styling = false }) {
        Surface(shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(18.dp).widthIn(max = 560.dp)) {
                Text("Text style (${texts.size} text box${if (texts.size == 1) "" else "es"})", fontWeight = FontWeight.Bold)
                TextStyleBar(style) { style = it }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { styling = false }) { Text("Cancel") }
                    Button(onClick = {
                        for (t in texts) { t.put("style", style); Core.call(h, "upsertItem", jo("page" to page, "item" to t, "noCommit" to true)) }
                        Core.call(h, "commit"); ink.sync(); ink.refreshSelection(); changed(); styling = false
                    }) { Text("Apply") }
                }
            }
        }
    }
}
