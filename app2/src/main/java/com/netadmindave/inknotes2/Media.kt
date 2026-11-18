package com.netadmindave.inknotes2

import android.content.Context
import android.graphics.pdf.PdfDocument
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.SystemClock
import java.io.File

/** Voice recording synced to handwriting: strokes written while recording remember the time. */
class Voice(private val ctx: Context, private val store: Store) {
    private var rec: MediaRecorder? = null
    var recIndex = -1; private set
    var recFile: String? = null; private set
    private var recStart = 0L
    val recording get() = rec != null
    fun elapsed() = if (rec != null) SystemClock.elapsedRealtime() - recStart else 0L

    fun start(): String? {
        val name = "v${System.currentTimeMillis()}.m4a"
        return try {
            @Suppress("DEPRECATION")
            val r = if (android.os.Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(96000); r.setAudioSamplingRate(44100)
            r.setOutputFile(store.media(name).path)
            r.prepare(); r.start()
            rec = r; recFile = name; recStart = SystemClock.elapsedRealtime()
            name
        } catch (e: Exception) { rec = null; null }
    }
    fun bind(index: Int) { recIndex = index }
    /** Stops; returns length in ms. */
    fun stop(): Long {
        val ms = elapsed()
        try { rec?.stop() } catch (_: Exception) {}
        rec?.release(); rec = null; recIndex = -1
        return ms
    }

    private var player: MediaPlayer? = null
    var playing = -1; private set
    fun play(index: Int, file: String, fromMs: Long, onDone: () -> Unit): Boolean {
        stopPlay()
        return try {
            val p = MediaPlayer()
            p.setDataSource(store.media(file).path)
            p.prepare()
            p.seekTo(fromMs.toInt())
            p.setOnCompletionListener { stopPlay(); onDone() }
            p.start()
            player = p; playing = index; true
        } catch (e: Exception) { false }
    }
    fun position(): Long = player?.currentPosition?.toLong() ?: 0L
    fun duration(): Long = player?.duration?.toLong() ?: 0L
    fun seek(ms: Long) { player?.seekTo(ms.toInt()) }
    fun pause() { player?.let { if (it.isPlaying) it.pause() else it.start() } }
    val paused get() = player?.isPlaying == false
    fun stopPlay() { try { player?.stop() } catch (_: Exception) {}; player?.release(); player = null; playing = -1 }
}

/** Export every page (paper, PDF background, items and ink) as a PDF file. */
fun exportPdf(view: InkView, out: File) {
    val doc = PdfDocument()
    for (i in 0 until view.pageCount()) {
        val w = view.pageW(i); val h = view.pageH(i)
        // page px are CSS px (96 dpi) → PDF points (72 dpi)
        val info = PdfDocument.PageInfo.Builder((w * 0.75f).toInt(), (h * 0.75f).toInt(), i + 1).create()
        val pg = doc.startPage(info)
        pg.canvas.scale(0.75f, 0.75f)
        view.drawPage(pg.canvas, i, true)
        doc.finishPage(pg)
    }
    out.outputStream().use { doc.writeTo(it) }
    doc.close()
}
