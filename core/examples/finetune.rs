//! Turns InkNotes training exports into fine-tuning data for the InkMath model (train/inkmath.py).
//! One JSON line per ink: {"strokes": [[[x,y],..],..], "latex": "...", "prompt": "...", "kind": "formula"|"symbol", "t": ms}
//! Whole formula attempts use the prompt as the label; single symbols are cut out of attempts using the
//! recorded symbol grouping wherever the recorded symbols pair up with the prompt's glyphs.
//!   SKIP=70,71 cargo run --release --example finetune -- out.jsonl export1.json [export2.json ...]
use inkcore::model::Stroke;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let skip: Vec<usize> = std::env::var("SKIP").unwrap_or_default().split(',').filter_map(|x| x.parse().ok()).collect();
    let mut out = std::fs::File::create(&a[1]).unwrap();
    let mut seen: HashSet<u64> = HashSet::new();
    let (mut nf, mut ns) = (0, 0);
    for path in &a[2..] {
        let d: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for (ri, r) in d["records"].as_array().unwrap().iter().enumerate() {
            if r["kind"] != "formula" || skip.contains(&ri) { continue; }
            let t = r["t"].as_u64().unwrap_or(0);
            if !seen.insert(t) { continue; }           // later exports repeat earlier records
            let strokes: Vec<Stroke> = serde_json::from_value(r["strokes"].clone()).unwrap();
            let pts = |ks: &[usize]| -> Vec<Vec<[f32; 2]>> { ks.iter().map(|&k| strokes[k].p.iter().map(|p| [p.x, p.y]).collect()).collect() };
            let expected = r["expected"].as_str().unwrap();
            let all: Vec<usize> = (0..strokes.len()).collect();
            writeln!(out, "{}", json!({"strokes": pts(&all), "latex": inkcore::asciimath::to_tex(expected), "prompt": expected, "kind": "formula", "t": t})).unwrap();
            nf += 1;
            // isolated symbols
            let syms = r["syms"].as_array().cloned().unwrap_or_default();
            let glyphs: Vec<String> = r["glyphs"].as_array().map(|g| g.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default();
            if glyphs.len() < 2 || syms.len() != glyphs.len() { continue; }
            let labels = corrected(&syms, &glyphs, &strokes);
            for (s, lab) in syms.iter().zip(labels) {
                let ks: Vec<usize> = s["strokes"].as_array().unwrap().iter().map(|k| k.as_u64().unwrap() as usize).collect();
                if lab.is_empty() { continue; }
                let tex = if ["(", ")", "[", "]", "|", ",", "."].contains(&lab.as_str()) { lab.clone() } else { inkcore::asciimath::to_tex(&lab) };
                if tex.is_empty() { continue; }
                writeln!(out, "{}", json!({"strokes": pts(&ks), "latex": tex, "prompt": expected, "kind": "symbol", "t": t})).unwrap();
                ns += 1;
            }
        }
    }
    eprintln!("{nf} formulas, {ns} symbols -> {}", a[1]);
}

/// Pair recorded symbols with the expected glyphs (as replay.rs does) to get the true character of each.
fn corrected(syms: &[Value], glyphs: &[String], strokes: &[Stroke]) -> Vec<String> {
    let mut idx: Vec<usize> = (0..syms.len()).collect();
    let x0 = |s: &Value| s["strokes"].as_array().unwrap().iter().map(|k| strokes[k.as_u64().unwrap() as usize].bounds().x0).fold(f32::MAX, f32::min);
    idx.sort_by(|&a, &b| x0(&syms[a]).partial_cmp(&x0(&syms[b])).unwrap());
    let mut out: Vec<String> = syms.iter().map(|s| s["ch"].as_str().unwrap().to_string()).collect();
    let mut remaining = glyphs.to_vec();
    let mut unmatched = vec![];
    for &i in &idx { if let Some(p) = remaining.iter().position(|g| *g == out[i]) { remaining.remove(p); } else { unmatched.push(i); } }
    // a single misread can only be one glyph; with several the pairing is a guess, so leave those out
    if unmatched.len() == 1 && remaining.len() == 1 { out[unmatched[0]] = remaining[0].clone(); }
    else { for &i in &unmatched { out[i] = String::new(); } }
    out
}
