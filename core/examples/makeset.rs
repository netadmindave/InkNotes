//! Builds an importable training set from an exported training log:
//! every recorded symbol whose identity is known (paired with the prompt) becomes a sample,
//! and every misread becomes a personal confusion pair.
use inkcore::dollarp;
use inkcore::model::Stroke;
use serde_json::{json, Value};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&a[1]).unwrap()).unwrap();
    dollarp::load(&d["samples"].to_string());
    let before: usize = dollarp::SYMBOLS.iter().map(|s| dollarp::count(s.0)).sum();
    let shown = |t: &str| dollarp::SYMBOLS.iter().find(|x| x.1 == t).map(|x| x.0.to_string());
    let (mut added, mut conf, mut skipped) = (0, 0, 0);
    // attempts to leave out (written for a different prompt), and word corrections to drop
    let skip: Vec<usize> = std::env::var("SKIP").unwrap_or_default().split(',').filter_map(|x| x.parse().ok()).collect();
    let drop: Vec<String> = std::env::var("DROP").unwrap_or_default().split(',').filter(|x| !x.is_empty()).map(String::from).collect();
    for (ri, r) in d["records"].as_array().unwrap().iter().enumerate() {
        if r["kind"] != "formula" || skip.contains(&ri) { continue; }
        let strokes: Vec<Stroke> = serde_json::from_value(r["strokes"].clone()).unwrap();
        let syms = r["syms"].as_array().cloned().unwrap_or_default();
        let glyphs: Vec<String> = r["glyphs"].as_array().map(|x| x.iter().map(|g| g.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        if syms.is_empty() || syms.len() != glyphs.len() { skipped += 1; continue; }
        let x0 = |s: &Value| s["strokes"].as_array().unwrap().iter().map(|k| strokes[k.as_u64().unwrap() as usize].bounds().x0).fold(f32::MAX, f32::min);
        let mut idx: Vec<usize> = (0..syms.len()).collect(); idx.sort_by(|&p, &q| x0(&syms[p]).partial_cmp(&x0(&syms[q])).unwrap());
        let read: Vec<String> = syms.iter().map(|s| s["ch"].as_str().unwrap().to_string()).collect();
        let mut truth = read.clone();
        let mut rem = glyphs.clone(); let mut un = vec![];
        for &i in &idx { if let Some(p) = rem.iter().position(|g| *g == truth[i]) { rem.remove(p); } else { un.push(i); } }
        // only trust the pairing when the leftovers are few (same rule as the app)
        if un.len() > 2.max(glyphs.len() * 2 / 5) { skipped += 1; continue; }
        for (j, &i) in un.iter().enumerate() { truth[i] = rem[j].clone(); }
        for (i, s) in syms.iter().enumerate() {
            if read[i] != truth[i] { dollarp::confusion_add(&read[i], &truth[i]); conf += 1; }
            let Some(sym) = shown(&truth[i]) else { continue };
            let g: Vec<&Stroke> = s["strokes"].as_array().unwrap().iter().map(|k| &strokes[k.as_u64().unwrap() as usize]).collect();
            if dollarp::add_sample(&sym, &g) { added += 1; }
        }
    }
    let after: usize = dollarp::SYMBOLS.iter().map(|s| dollarp::count(s.0)).sum();
    let mut corr = d["corrections"].clone();
    if let Some(o) = corr.as_object_mut() { for k in &drop { o.remove(k); } }
    let out = json!({
        "app": "InkNotes", "type": "training-set", "version": 1,
        "made_from": a[1].rsplit('/').next(),
        "samples": serde_json::from_str::<Value>(&dollarp::save()).unwrap(),
        "confusions": serde_json::from_str::<Value>(&dollarp::confusions_save()).unwrap(),
        "corrections": corr,
        "removeCorrections": drop,
        "passes": d["passes"].clone(),
    });
    std::fs::write(&a[2], serde_json::to_string(&out).unwrap()).unwrap();
    eprintln!("symbol samples {before} -> {after} (+{added} from formulas), {conf} confusion pairs, {skipped} attempts skipped");
    let c: Value = serde_json::from_str(&dollarp::confusions_save()).unwrap();
    eprintln!("confusions: {}", c);
}
