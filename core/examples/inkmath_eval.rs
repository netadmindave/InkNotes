//! Scores a trained InkMath model on recorded InkNotes formula attempts, through the same Rust code the app uses.
//!   cargo run --release --example inkmath_eval -- inkmath.onnx vocab.json export.json [skip,list]
use inkcore::inkmath::{canon, InkMath};
use inkcore::model::Stroke;
use serde_json::Value;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let m = InkMath::load(&std::fs::read(&a[1]).unwrap(), &std::fs::read_to_string(&a[2]).unwrap()).unwrap();
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&a[3]).unwrap()).unwrap();
    let skip: Vec<usize> = a.get(4).map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
    let (mut ok, mut n) = (0, 0);
    let mut by_conf: Vec<(f32, bool)> = vec![];
    let t = std::time::Instant::now();
    for (ri, r) in d["records"].as_array().unwrap().iter().enumerate() {
        if r["kind"] != "formula" || skip.contains(&ri) { continue; }
        let strokes: Vec<Stroke> = serde_json::from_value(r["strokes"].clone()).unwrap();
        let ink: Vec<Vec<(f64, f64)>> = strokes.iter().map(|s| s.p.iter().map(|p| (p.x as f64, p.y as f64)).collect()).collect();
        let want = inkcore::asciimath::to_tex(r["expected"].as_str().unwrap());
        let got = m.recognize(&ink).unwrap();
        let good = got.tokens == canon(&want);
        n += 1; if good { ok += 1; }
        by_conf.push((got.conf, good));
        println!("{ri:>3} {} want {:<36} got {:<36} conf {:.2}", if good { "✓" } else { "✗" }, want, got.latex, got.conf);
    }
    println!("{ok}/{n} exactly right ({:?} total)", t.elapsed());
    by_conf.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    for th in [0.9, 0.8, 0.7, 0.6, 0.5, 0.4] {
        let sel: Vec<_> = by_conf.iter().filter(|x| x.0 >= th).collect();
        println!("  conf ≥ {th}: {} attempts, {} right", sel.len(), sel.iter().filter(|x| x.1).count());
    }
}
