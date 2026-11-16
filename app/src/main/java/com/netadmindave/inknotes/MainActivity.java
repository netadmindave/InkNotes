package com.netadmindave.inknotes;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.Ink;
import com.google.mlkit.vision.digitalink.RecognitionCandidate;
import com.google.mlkit.vision.digitalink.RecognitionContext;
import com.google.mlkit.vision.digitalink.RecognitionResult;
import com.google.mlkit.vision.digitalink.WritingArea;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * InkNotes: a handwriting-styled, math-aware notes app.
 * The UI is an offline web app in assets/www; this activity hosts it and
 * provides file storage, sharing, PDF export and backup through a JS bridge.
 */
public class MainActivity extends Activity {

    private static final int REQ_SAVE_BACKUP = 41;
    private static final int REQ_FILE_CHOOSER = 42;

    private WebView web;
    private String pendingBackup;
    private ValueCallback<Uri[]> fileCallback;

    // ---- S Pen state + palm rejection ----
    // The page asks penNear() and ignores finger/palm touches while the pen is close.
    private volatile boolean penHover = false, penTouch = false, penButton = false;
    private volatile long penSeenAt = 0;
    private static final long PEN_GRACE_MS = 1200;

    private static boolean isPen(int toolType) {
        return toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER;
    }

    private boolean penNearNow() {
        return penTouch || penHover || SystemClock.uptimeMillis() - penSeenAt < PEN_GRACE_MS;
    }

    private void notePen(MotionEvent ev, int i) {
        penSeenAt = SystemClock.uptimeMillis();
        int bs = ev.getButtonState();
        penButton = (bs & (MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_SECONDARY | MotionEvent.BUTTON_STYLUS_SECONDARY)) != 0
                || ev.getToolType(i) == MotionEvent.TOOL_TYPE_ERASER;
    }

    private boolean onHover(MotionEvent ev) {
        if (ev.getPointerCount() > 0 && isPen(ev.getToolType(0))) {
            notePen(ev, 0);
            penHover = ev.getActionMasked() != MotionEvent.ACTION_HOVER_EXIT;
        }
        return false;   // the WebView still gets hover events
    }

    /** Track the S Pen; never consume events, so pen positions always take the WebView's normal path. */
    private boolean onTouch(MotionEvent ev) {
        int act = ev.getActionMasked();
        for (int i = 0; i < ev.getPointerCount(); i++) {
            if (!isPen(ev.getToolType(i))) continue;
            notePen(ev, i);
            boolean lifting = act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL
                    || (act == MotionEvent.ACTION_POINTER_UP && ev.getActionIndex() == i);
            penTouch = !lifting;
        }
        return false;
    }

    // ---- handwriting recognition (Google ML Kit Digital Ink, on-device) ----
    private DigitalInkRecognitionModel inkModel;
    private DigitalInkRecognizer inkRecognizer;
    private volatile String inkState = "checking";   // checking | ready | missing | downloading | unavailable

    private void initInk() {
        try {
            DigitalInkRecognitionModelIdentifier id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US");
            if (id == null) { inkState = "unavailable"; return; }
            inkModel = DigitalInkRecognitionModel.builder(id).build();
            RemoteModelManager.getInstance().isModelDownloaded(inkModel)
                    .addOnSuccessListener(ok -> {
                        if (Boolean.TRUE.equals(ok)) makeRecognizer(); else inkState = "missing";
                    })
                    .addOnFailureListener(e -> inkState = "missing");
        } catch (Throwable t) {
            inkState = "unavailable";
        }
    }

    private void makeRecognizer() {
        if (inkRecognizer == null) {
            inkRecognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(inkModel).build());
        }
        inkState = "ready";
    }

    private void jsReply(String id, boolean ok, String payload) {
        runOnUiThread(() -> {
            if (web == null) return;
            String js = "window.InkRec && InkRec.onNative(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload) + ")";
            web.evaluateJavascript(js, null);
        });
    }

    private Ink buildInk(JSONArray strokes) throws Exception {
        Ink.Builder ib = Ink.builder();
        long t = 1000;
        for (int i = 0; i < strokes.length(); i++) {
            JSONArray pts = strokes.getJSONArray(i);
            Ink.Stroke.Builder sb = Ink.Stroke.builder();
            long last = -1;
            for (int j = 0; j < pts.length(); j++) {
                JSONArray q = pts.getJSONArray(j);
                long ts = q.length() > 2 ? q.getLong(2) : 0;
                long abs = t + (ts > 0 ? ts : j * 8L);
                if (abs <= last) abs = last + 1;
                last = abs;
                sb.addPoint(Ink.Point.create((float) q.getDouble(0), (float) q.getDouble(1), abs));
            }
            ib.addStroke(sb.build());
            t = last + 250;
        }
        return ib.build();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setOnHoverListener((v, ev) -> onHover(ev));
        web.setOnTouchListener((v, ev) -> onTouch(ev));

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:///android_asset/")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        initInk();
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.InkNotes && InkNotes.onBack()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.InkNotes && InkNotes.flush()", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                Uri[] res = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    res = new Uri[]{data.getData()};
                }
                fileCallback.onReceiveValue(res);
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackup != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    os.write(pendingBackup.getBytes(StandardCharsets.UTF_8));
                    toast("Backup saved");
                } catch (Exception e) {
                    toast("Backup failed: " + e.getMessage());
                }
            }
            pendingBackup = null;
        }
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    private File notesDir() {
        File d = new File(getFilesDir(), "notes");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static boolean safeName(String name) {
        return name != null && name.matches("[A-Za-z0-9_\\-]{1,80}");
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Methods callable from JavaScript as window.Android.*. */
    public class Bridge {

        @JavascriptInterface
        public String readAsset(String path) {
            try {
                return readAll(getAssets().open(path));
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String listNotes() {
            File[] files = notesDir().listFiles();
            StringBuilder sb = new StringBuilder("[");
            if (files != null) {
                boolean first = true;
                for (File f : files) {
                    String n = f.getName();
                    if (!n.endsWith(".json")) continue;
                    if (!first) sb.append(',');
                    first = false;
                    sb.append('"').append(n.substring(0, n.length() - 5)).append('"');
                }
            }
            return sb.append(']').toString();
        }

        @JavascriptInterface
        public String load(String id) {
            if (!safeName(id)) return "";
            File f = new File(notesDir(), id + ".json");
            if (!f.exists()) return "";
            try {
                return readAll(new FileInputStream(f));
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean save(String id, String json) {
            if (!safeName(id)) return false;
            File tmp = new File(notesDir(), id + ".json.tmp");
            File f = new File(notesDir(), id + ".json");
            try (FileOutputStream os = new FileOutputStream(tmp)) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
                os.getFD().sync();
            } catch (Exception e) {
                return false;
            }
            return tmp.renameTo(f);
        }

        @JavascriptInterface
        public boolean remove(String id) {
            if (!safeName(id)) return false;
            return new File(notesDir(), id + ".json").delete();
        }

        @JavascriptInterface
        public String getPref(String key) {
            return getSharedPreferences("inknotes", Context.MODE_PRIVATE).getString(key, "");
        }

        @JavascriptInterface
        public void setPref(String key, String value) {
            getSharedPreferences("inknotes", Context.MODE_PRIVATE).edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Share note"));
            });
        }

        /** True when the device has a stylus digitizer (S Pen); phones like the Pixel return false. */
        @JavascriptInterface
        public boolean hasStylus() {
            for (int id : InputDevice.getDeviceIds()) {
                InputDevice d = InputDevice.getDevice(id);
                if (d != null && d.supportsSource(InputDevice.SOURCE_STYLUS)) return true;
            }
            return false;
        }

        @JavascriptInterface
        public void printPdf(String title, String size) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                String name = (title == null || title.trim().isEmpty()) ? "InkNotes" : title.trim();
                PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(name);
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize("a4".equals(size) ? PrintAttributes.MediaSize.ISO_A4 : PrintAttributes.MediaSize.NA_LETTER)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                pm.print(name, adapter, attrs);
            });
        }

        @JavascriptInterface
        public void saveBackup(String fileName, String json) {
            runOnUiThread(() -> {
                pendingBackup = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(i, REQ_SAVE_BACKUP);
                } catch (Exception e) {
                    toast("No file picker available");
                }
            });
        }

        /** Is the S Pen touching, hovering, or used within the last moment? (palm rejection) */
        @JavascriptInterface
        public boolean penNear() {
            return penNearNow();
        }

        /** Is the S Pen side button held (or the eraser end in use)? */
        @JavascriptInterface
        public boolean penButton() {
            return penButton;
        }

        @JavascriptInterface
        public String inkStatus() {
            return inkState;
        }

        @JavascriptInterface
        public void inkDownload(String id, String json) {
            runOnUiThread(() -> {
                if (inkModel == null) { jsReply(id, false, "Handwriting recognition isn't available on this device"); return; }
                if ("ready".equals(inkState)) { jsReply(id, true, "\"ready\""); return; }
                inkState = "downloading";
                RemoteModelManager.getInstance()
                        .download(inkModel, new DownloadConditions.Builder().build())
                        .addOnSuccessListener(v -> { makeRecognizer(); jsReply(id, true, "\"ready\""); })
                        .addOnFailureListener(e -> { inkState = "missing"; jsReply(id, false, "Download failed: " + e.getMessage()); });
            });
        }

        /** json: [{w,h,pre,strokes:[[[x,y,t],...],...]}, ...] → [[{t,s},...], ...] in the same order */
        @JavascriptInterface
        public void inkRecognize(String id, String json) {
            runOnUiThread(() -> {
                if (inkRecognizer == null) { jsReply(id, false, "Handwriting model not downloaded"); return; }
                try {
                    JSONArray reqs = new JSONArray(json);
                    List<Task<RecognitionResult>> tasks = new ArrayList<>();
                    for (int i = 0; i < reqs.length(); i++) {
                        JSONObject r = reqs.getJSONObject(i);
                        Ink ink = buildInk(r.getJSONArray("strokes"));
                        RecognitionContext ctx = RecognitionContext.builder()
                                .setPreContext(r.optString("pre", ""))
                                .setWritingArea(new WritingArea((float) Math.max(1, r.optDouble("w", 100)), (float) Math.max(1, r.optDouble("h", 40))))
                                .build();
                        tasks.add(inkRecognizer.recognize(ink, ctx));
                    }
                    Tasks.whenAllComplete(tasks).addOnCompleteListener(all -> {
                        try {
                            JSONArray out = new JSONArray();
                            for (Task<RecognitionResult> t : tasks) {
                                JSONArray cands = new JSONArray();
                                if (t.isSuccessful() && t.getResult() != null) {
                                    for (RecognitionCandidate c : t.getResult().getCandidates()) {
                                        JSONObject o = new JSONObject();
                                        o.put("t", c.getText());
                                        Float sc = c.getScore();
                                        if (sc != null) o.put("s", sc.doubleValue());
                                        cands.put(o);
                                        if (cands.length() >= 8) break;
                                    }
                                }
                                out.put(cands);
                            }
                            jsReply(id, true, out.toString());
                        } catch (Exception e) {
                            jsReply(id, false, String.valueOf(e.getMessage()));
                        }
                    });
                } catch (Exception e) {
                    jsReply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }
    }
}
