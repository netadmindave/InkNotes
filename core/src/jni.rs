//! JNI bridge for the Android app (class com.netadmindave.inknotes2.Core).
//! Hot paths (pen input, geometry) use primitive arrays; everything else is JSON through `call`/`util`.

use crate::doc::Doc;
use crate::ink::{self, Geometry};
use crate::model::{new_id, page_size, Item, Note, Page, PageBg, Recording, Rect, Stroke};
use crate::{asciimath, cleanup, dollarp, mathtext, recognize};
use jni::objects::{JClass, JFloatArray, JString};
use jni::sys::{jboolean, jfloatArray, jint, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;
use serde_json::{json, Value};

fn s(env: &mut JNIEnv, j: &JString) -> String { env.get_string(j).map(|x| x.into()).unwrap_or_default() }
fn out(env: &mut JNIEnv, v: &str) -> jstring { env.new_string(v).map(|x| x.into_raw()).unwrap_or(std::ptr::null_mut()) }
fn farr(env: &mut JNIEnv, v: &[f32]) -> jfloatArray {
    let a = env.new_float_array(v.len() as i32).unwrap();
    env.set_float_array_region(&a, 0, v).unwrap();
    a.into_raw()
}
fn doc<'a>(h: jlong) -> &'a mut Doc { unsafe { &mut *(h as *mut Doc) } }
fn bool_(b: bool) -> jboolean { if b { JNI_TRUE } else { JNI_FALSE } }

fn color_num(c: &str) -> f32 {
    let h = c.trim_start_matches('#');
    let h = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect() } else { h.to_string() };
    u32::from_str_radix(&h[..6.min(h.len())], 16).unwrap_or(0) as f32
}

/// Packed geometry: per stroke [mode, n, rgb, opacity, width, dash, closed, smooth, rec, ms] + n*(x,y).
/// rec/ms: voice-recording sync (-1 when the stroke wasn't written during a recording).
/// mode 0 = filled outline, 1 = stroked line. rgb is exact (24 bits fit an f32 mantissa).
pub fn pack(strokes: &[Stroke], out: &mut Vec<f32>) {
    for st in strokes {
        let (mode, pts, closed, smooth) = match ink::geometry(st) {
            Geometry::Fill(p) => (0.0, p, false, false),
            Geometry::Line { pts, closed, smooth } => (1.0, pts, closed, smooth),
        };
        let dash = match st.d.as_str() { "dash" => 1.0, "dot" => 2.0, _ => 0.0 };
        let (rec, ms) = st.rt.map(|(r, t)| (r as f32, t as f32)).unwrap_or((-1.0, -1.0));
        out.extend([mode, pts.len() as f32, color_num(&st.c), ink::opacity(st), ink::width_of(st), dash, closed as u8 as f32, smooth as u8 as f32, rec, ms]);
        for p in pts { out.extend(p); }
    }
}

fn rects(v: &Value) -> Vec<(String, Rect)> {
    v.as_array().map(|a| a.iter().filter_map(|r| {
        let r = r.as_array()?;
        let f = |i: usize| r.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
        Some((r.first()?.as_str()?.to_string(), Rect { x0: f(1), y0: f(2), x1: f(3), y1: f(4) }))
    }).collect()).unwrap_or_default()
}

#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_open(mut env: JNIEnv, _: JClass, json: JString) -> jlong {
    let j = s(&mut env, &json);
    match Doc::open(&j) { Ok(d) => Box::into_raw(Box::new(d)) as jlong, Err(_) => 0 }
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_free(_: JNIEnv, _: JClass, h: jlong) {
    if h != 0 { unsafe { drop(Box::from_raw(h as *mut Doc)); } }
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_begin(_: JNIEnv, _: JClass, h: jlong, page: jint, x: f32, y: f32, p: f32, btn: jboolean, rec: jint, rec_ms: jlong) {
    doc(h).begin(page as usize, x, y, p, btn != 0, if rec >= 0 { Some((rec as u32, rec_ms)) } else { None });
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_extend(env: JNIEnv, _: JClass, h: jlong, pts: JFloatArray) {
    let n = env.get_array_length(&pts).unwrap_or(0) as usize;
    let mut v = vec![0f32; n];
    if env.get_float_array_region(&pts, 0, &mut v).is_err() { return; }
    let q: Vec<[f32; 4]> = v.chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
    doc(h).extend(&q);
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_end(mut env: JNIEnv, _: JClass, h: jlong, held: jboolean, item_rects: JString) -> jint {
    let r = rects(&serde_json::from_str(&s(&mut env, &item_rects)).unwrap_or(Value::Null));
    doc(h).end(held != 0, &r) as jint
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_livePage(_: JNIEnv, _: JClass, h: jlong) -> jint {
    doc(h).live_page().map(|p| p as jint).unwrap_or(-1)
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_liveGeom(mut env: JNIEnv, _: JClass, h: jlong, held: jboolean) -> jfloatArray {
    let d = doc(h);
    let mut v = vec![];
    if let Some(st) = d.live_stroke(held != 0) { pack(&[st], &mut v); }
    else if let Some(poly) = d.live_lasso() { v.extend([-1.0, poly.len() as f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -1.0]); for p in poly { v.extend(p); } }
    farr(&mut env, &v)
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_pageGeom(mut env: JNIEnv, _: JClass, h: jlong, page: jint) -> jfloatArray {
    let d = doc(h);
    let mut v = vec![];
    if let Some(pg) = d.note.pages.get(page as usize) { pack(&pg.strokes, &mut v); }
    farr(&mut env, &v)
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_version(_: JNIEnv, _: JClass, h: jlong, page: jint) -> jlong {
    doc(h).versions.get(page as usize).copied().unwrap_or(0) as jlong
}
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_takeDirty(_: JNIEnv, _: JClass, h: jlong) -> jboolean { bool_(doc(h).take_dirty()) }

/// Everything else on an open note: `op` + JSON argument → JSON result.
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_call(mut env: JNIEnv, _: JClass, h: jlong, op: JString, arg: JString) -> jstring {
    let op = s(&mut env, &op);
    let a: Value = serde_json::from_str(&s(&mut env, &arg)).unwrap_or(Value::Null);
    let r = call(doc(h), &op, &a);
    out(&mut env, &r.to_string())
}

pub fn call(d: &mut Doc, op: &str, a: &Value) -> Value {
    let f = |k: &str| a.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
    let i = |k: &str| a.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
    let st = |k: &str| a.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let b = |k: &str| a.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    match op {
        "json" => return Value::String(d.note.to_json()),
        "meta" => {
            return json!({ "id": d.note.id, "title": d.note.title, "size": d.note.size, "paper": d.note.paper, "pages": d.note.pages.len(),
                "recordings": d.note.recordings, "undo": d.can_undo(), "redo": d.can_redo(), "sel": d.sel.as_ref().map(|s| json!({"page": s.page,
                "strokes": s.strokes.len(), "items": s.items.iter().collect::<Vec<_>>()})) });
        }
        "page" => {
            let Some(pg) = d.note.pages.get(i("page") as usize) else { return Value::Null };
            return json!({ "id": pg.id, "w": pg.w, "h": pg.h, "items": pg.items, "bg": pg.bg, "paper": if pg.paper.is_empty() { &d.note.paper } else { &pg.paper } });
        }
        "tool" => {
            let t = &mut d.tool;
            t.kind = st("kind"); t.color = st("color"); t.size = f("size"); t.dash = st("dash");
            t.shapes = b("shapes"); t.eraser_size = f("eraserSize"); t.eraser_whole = b("eraserWhole");
        }
        "cancel" => d.cancel(),
        "undo" => { d.undo(); }
        "redo" => { d.redo(); }
        "title" => { d.note.title = st("title"); d.commit(); }
        "paper" => { d.note.paper = st("paper"); for p in 0..d.note.pages.len() { d.versions[p] += 1; } d.commit(); }
        "size" => { d.set_size(&st("size")); }
        "addPage" => { let at = (i("at") as usize).min(d.note.pages.len()); d.add_page(at, i("now")); }
        "removePage" => d.remove_page(i("page") as usize),
        "movePage" => d.move_page(i("from") as usize, i("to") as usize),
        "addPdf" => {
            // append one page per PDF page, sized to fit the note's width
            let (w, _) = page_size(&d.note.size);
            let now = i("now");
            for (k, p) in a.get("pages").and_then(|x| x.as_array()).cloned().unwrap_or_default().iter().enumerate() {
                let pw = p.get(0).and_then(|x| x.as_f64()).unwrap_or(612.0) as f32;
                let ph = p.get(1).and_then(|x| x.as_f64()).unwrap_or(792.0) as f32;
                let mut pg = Page::blank(new_id("p", now + k as i64), w, (ph * w / pw).round());
                pg.bg = Some(PageBg { pdf: st("pdf"), page: k as u32 });
                pg.paper = "plain".into();
                d.note.pages.push(pg);
            }
            // a brand-new note's empty first page gives way to the PDF
            if d.note.pages.len() > 1 && d.note.pages[0].bg.is_none() && d.note.pages[0].strokes.is_empty() && d.note.pages[0].items.is_empty() && b("replaceBlank") {
                d.note.pages.remove(0);
            }
            d.versions = vec![1; d.note.pages.len()];
            d.commit();
        }
        "addRecording" => {
            d.note.recordings.push(Recording { file: st("file"), ms: i("ms"), created: i("created") });
            d.commit();
            return json!(d.note.recordings.len() - 1);
        }
        "setRecordingLength" => { if let Some(r) = d.note.recordings.get_mut(i("index") as usize) { r.ms = i("ms"); d.commit(); } }
        "removeRecording" => {
            let k = i("index") as usize;
            if k < d.note.recordings.len() {
                d.note.recordings.remove(k);
                for pg in d.note.pages.iter_mut() { for s in pg.strokes.iter_mut() { s.rt = match s.rt { Some((r, _)) if r as usize == k => None, Some((r, t)) if r as usize > k => Some((r - 1, t)), o => o }; } }
                d.commit();
            }
        }
        "clearSel" => d.clear_selection(),
        "selBounds" => return d.selection_bounds(&rects(&a["rects"])).map(|r| json!([r.x0, r.y0, r.x1, r.y1])).unwrap_or(Value::Null),
        "moveSel" => d.move_selection(f("dx"), f("dy")),
        "deleteSel" => d.delete_selection(),
        "smoothSel" => d.smooth_selection(),
        "recolorSel" => d.recolor_selection(&st("color")),
        "selStrokes" => return serde_json::to_value(d.selected_strokes()).unwrap_or(Value::Null),
        "selectAll" => {
            let p = i("page") as usize;
            if let Some(pg) = d.note.pages.get(p) {
                d.sel = Some(crate::doc::Selection { page: p, strokes: (0..pg.strokes.len()).collect(), items: pg.items.iter().map(|x| x.id.clone()).collect() });
                d.versions[p] += 1;
            }
        }
        "replaceSel" => {
            let items: Vec<Item> = serde_json::from_value(a["items"].clone()).unwrap_or_default();
            d.replace_selection_with(items, b("keepInk"));
        }
        "upsertItem" => {
            if let Ok(it) = serde_json::from_value::<Item>(a["item"].clone()) { d.upsert_item(i("page") as usize, it); if !b("noCommit") { d.commit(); } }
        }
        "commit" => d.commit(),
        "removeItem" => { d.remove_item(&st("id")); d.commit(); }
        "smoothAll" => { let n = d.smooth_all(); d.commit(); return json!(n); }
        "pageStrokes" => return d.note.pages.get(i("page") as usize).map(|p| serde_json::to_value(&p.strokes).unwrap_or(Value::Null)).unwrap_or(Value::Null),
        "strokesAt" => {
            // strokes with a voice-sync time near a point (for "play from here")
            let p = i("page") as usize;
            let (x, y, r) = (f("x"), f("y"), f("r").max(8.0));
            let hit = d.note.pages.get(p).and_then(|pg| pg.strokes.iter().rev().find(|s| s.rt.is_some() && s.p.iter().any(|q| (q.x - x).hypot(q.y - y) < r)).and_then(|s| s.rt));
            return hit.map(|(r, t)| json!([r, t])).unwrap_or(Value::Null);
        }
        _ => return json!({ "error": format!("unknown op {op}") }),
    }
    Value::Bool(true)
}

/// Stateless helpers: `op` + JSON argument → JSON result.
#[no_mangle]
pub extern "system" fn Java_com_netadmindave_inknotes2_Core_util(mut env: JNIEnv, _: JClass, op: JString, arg: JString) -> jstring {
    let op = s(&mut env, &op);
    let a = s(&mut env, &arg);
    let r = util(&op, &a);
    out(&mut env, &r.to_string())
}

static RECO: std::sync::Mutex<Option<recognize::Job>> = std::sync::Mutex::new(None);

pub fn util(op: &str, raw: &str) -> Value {
    let a: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    let st = |k: &str| a.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let strokes = |k: &str| -> Vec<Stroke> { serde_json::from_value(a[k].clone()).unwrap_or_default() };
    match op {
        "newNote" => {
            let now = a["now"].as_i64().unwrap_or(0);
            let mut n = Note::new(new_id("n", now), now, &st("paper"), &st("size"));
            n.title = st("title");
            Value::String(n.to_json())
        }
        "preview" => Note::parse(raw).map(|n| json!({ "id": n.id, "title": n.title, "updated": n.updated, "created": n.created, "preview": n.preview(),
            "pages": n.pages.len(), "pinned": n.pinned, "tags": n.tags })).unwrap_or(Value::Null),
        "migrate" => Note::parse(raw).map(|n| Value::String(n.to_json())).unwrap_or(Value::Null),
        "tex" => Value::String(asciimath::to_tex(raw)),
        "mathRuns" => json!(mathtext::find_math_runs(raw)),
        "clean" => {
            let words: Vec<String> = serde_json::from_value(a["words"].clone()).unwrap_or_default();
            serde_json::to_value(cleanup::clean_text(&st("text"), &cleanup::Speller::new(&words), a["autoMath"].as_bool().unwrap_or(true))).unwrap_or(Value::Null)
        }
        "misspelt" => {
            let words: Vec<String> = serde_json::from_value(a["words"].clone()).unwrap_or_default();
            json!(cleanup::misspelt(&st("text"), &cleanup::Speller::new(&words), true))
        }
        "suggest" => json!(cleanup::Speller::new(&[]).suggestions(&st("word"))),
        "recoStart" => {
            let job = recognize::Job::new(strokes("strokes"), &st("mode"));
            let mut g = RECO.lock().unwrap();
            *g = Some(job);
            reco_state(g.as_ref().unwrap())
        }
        "recoFeed" => {
            let answers: Vec<Vec<String>> = serde_json::from_value(a.clone()).unwrap_or_default();
            let mut g = RECO.lock().unwrap();
            match g.as_mut() { Some(j) => { j.feed(answers); reco_state(j) } None => Value::Null }
        }
        "lines" => {
            let ss = strokes("strokes");
            json!(recognize::split_lines(&ss))
        }
        "trainLoad" => { dollarp::load(raw); Value::Bool(true) }
        "trainSave" => serde_json::from_str(&dollarp::save()).unwrap_or(Value::Null),
        "trainAdd" => { let ss = strokes("strokes"); json!(dollarp::add_sample(&st("sym"), &ss.iter().collect::<Vec<_>>())) }
        "trainCount" => json!(dollarp::SYMBOLS.iter().map(|(s, _)| (s.to_string(), dollarp::count(s))).collect::<Vec<_>>()),
        "trainClear" => { let k = st("sym"); dollarp::clear(if k.is_empty() { None } else { Some(&k) }); Value::Bool(true) }
        "classify" => { let ss = strokes("strokes"); json!(dollarp::classify(&ss.iter().collect::<Vec<_>>()).into_iter().take(5).collect::<Vec<_>>()) }
        "geom" => { let mut v = vec![]; pack(&strokes("strokes"), &mut v); json!(v) }
        _ => json!({ "error": format!("unknown util {op}") }),
    }
}

fn reco_state(j: &recognize::Job) -> Value {
    match j.requests() {
        Some(r) => json!({ "requests": r }),
        None => json!({ "result": j.result() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ops() {
        let n = util("newNote", r#"{"now":1700000000000,"paper":"lined","size":"letter"}"#);
        let mut d = Doc::open(n.as_str().unwrap()).unwrap();
        d.tool.kind = "pen".into();
        d.tool.size = 2.0;
        d.tool.color = "#1a73e8".into();
        d.begin(0, 10.0, 10.0, 0.5, false, None);
        d.extend(&[[20.0, 12.0, 0.5, 5.0], [40.0, 30.0, 0.5, 10.0]]);
        assert_eq!(d.end(false, &[]), 1);
        let mut v = vec![];
        pack(&d.note.pages[0].strokes, &mut v);
        assert_eq!(v[0], 0.0);
        assert!(v[1] > 4.0);
        call(&mut d, "addPdf", &json!({"pdf": "x.pdf", "pages": [[612, 792], [612, 792]], "now": 5}));
        assert_eq!(d.note.pages.len(), 3);
        assert_eq!(d.note.pages[1].h, 1056.0);
        assert_eq!(call(&mut d, "meta", &Value::Null)["pages"], 3);
        assert_eq!(util("tex", "x^2"), json!("x^{2}"));
        assert_eq!(color_num("#1a73e8"), 0x1a73e8 as f32);
    }
}
