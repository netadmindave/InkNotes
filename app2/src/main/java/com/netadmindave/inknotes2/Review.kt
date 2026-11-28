package com.netadmindave.inknotes2

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** One converted piece: the ink it came from, and the editable result. */
class ReviewRow(val ink: Bitmap?, val x0: Float, val y0: Float, val y1: Float, kind0: String, text0: String, tex0: String, val alts: List<String>, val texAlts: List<String> = emptyList()) {
    var kind by mutableStateOf(kind0)
    var text by mutableStateOf(text0)
    var tex by mutableStateOf(tex0)
    var skip by mutableStateOf(false)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MainActivity.ReviewDialog(rows: List<ReviewRow>) {
    var mathRow by remember(rows) { mutableStateOf<ReviewRow?>(if (reviewEditFirst) rows.firstOrNull { it.kind == "math" } else null) }
    Dialog(onDismissRequest = { review = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.94f), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(14.dp)) {
                Text("Check the conversion", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("Your writing on the left, what it became on the right. Fix anything that's wrong, then Insert.", fontSize = 13.sp, color = Color(0xFF6B6B6B))
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 8.dp)) {
                    rows.forEach { r ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).background(if (r.skip) Color(0x0F000000) else Color.Transparent, RoundedCornerShape(10.dp)).padding(6.dp)) {
                            Box(Modifier.weight(0.42f).heightIn(min = 60.dp, max = 220.dp).background(Paper).border(1.dp, Color(0xFFD8D0BD))) {
                                r.ink?.let { Image(it.asImageBitmap(), "Your handwriting", Modifier.fillMaxWidth().padding(4.dp), contentScale = ContentScale.Fit) }
                            }
                            Text("→", Modifier.padding(horizontal = 8.dp).align(Alignment.CenterVertically), fontSize = 22.sp, color = Color(0xFF8A8A8A))
                            Column(Modifier.weight(0.58f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    FilterChip(r.kind == "text", { if (r.kind == "math") { r.text = r.alts.firstOrNull() ?: r.tex; r.kind = "text" } }, { Text("Text") }, Modifier.padding(end = 4.dp))
                                    FilterChip(r.kind == "math", { if (r.kind == "text") { r.tex = srcToLatex(r.text); r.kind = "math" } }, { Text("Formula") }, Modifier.padding(end = 4.dp))
                                    Spacer(Modifier.weight(1f))
                                    TextButton(onClick = { r.skip = !r.skip }) { Text(if (r.skip) "Include" else "Leave as ink", fontSize = 13.sp) }
                                }
                                if (r.kind == "text") {
                                    OutlinedTextField(r.text, { r.text = it }, Modifier.fillMaxWidth(), enabled = !r.skip, textStyle = TextStyle(fontFamily = Hand, fontSize = 24.sp, color = InkC))
                                    if (r.alts.isNotEmpty()) FlowRow {
                                        Text("Or: ", fontSize = 13.sp, modifier = Modifier.align(Alignment.CenterVertically))
                                        r.alts.forEach { a -> SuggestionChip({ r.text = a }, { Text(a, maxLines = 1) }, Modifier.padding(2.dp)) }
                                    }
                                } else {
                                    Box(Modifier.fillMaxWidth().heightIn(min = 56.dp).border(if (mathRow === r) 2.dp else 1.dp, if (mathRow === r) Accent else Color(0xFFD8D0BD), RoundedCornerShape(8.dp))
                                        .background(Color.White, RoundedCornerShape(8.dp)).clickable(enabled = !r.skip) { mathRow = r }.padding(8.dp)) {
                                        TexImage(latexToSrc(r.tex), 26f, Modifier.fillMaxWidth())
                                    }
                                    Text(if (mathRow === r) "Editing below" else "Tap the formula to edit it", fontSize = 12.sp, color = Color(0xFF8A8A8A))
                                    if (r.texAlts.isNotEmpty() && !r.skip) FlowRow {
                                        Text("Or: ", fontSize = 13.sp, modifier = Modifier.align(Alignment.CenterVertically))
                                        r.texAlts.forEach { a ->
                                            Box(Modifier.padding(2.dp).border(1.dp, Color(0xFFD8D0BD), RoundedCornerShape(8.dp)).clickable { r.tex = a; if (mathRow === r) mathRow = null }.padding(horizontal = 8.dp, vertical = 4.dp)) {
                                                TexImage(latexToSrc(a), 18f, Modifier.widthIn(max = 260.dp))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        HorizontalDivider()
                    }
                }
                mathRow?.let { r ->
                    key(r) { MathField(r.tex, Modifier.fillMaxWidth().height(400.dp).padding(top = 6.dp)) { t -> r.tex = t } }
                }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { keepInk = !keepInk }) {
                        Checkbox(keepInk, { keepInk = it }); Text("Keep my handwriting too", fontSize = 14.sp)
                    }
                    Spacer(Modifier.weight(1f))
                    if (mathRow != null) TextButton(onClick = { mathRow = null }) { Text("Close editor") }
                    TextButton(onClick = { review = null }) { Text("Cancel") }
                    Button(onClick = { applyReview(rows) }) { Text("Insert") }
                }
            }
        }
    }
}
