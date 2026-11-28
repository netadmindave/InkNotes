//! Checks the Rust model runner and preprocessing against Python.  cargo run --release --example inkmath_parity -- model.onnx xy.json [vocab.json]
use serde_json::Value;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let onnx = std::fs::read(&a[1]).unwrap();
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&a[2]).unwrap()).unwrap();
    let vocab = a.get(3).map(|p| std::fs::read_to_string(p).unwrap()).unwrap_or_else(|| {
        let n = d["y"][0].as_array().unwrap().len();
        serde_json::json!({"tokens": (0..n).map(|i| format!("t{i}")).collect::<Vec<_>>()}).to_string()
    });
    let t = std::time::Instant::now();
    let m = inkcore::inkmath::InkMath::load(&onnx, &vocab).unwrap();
    println!("load {:?}", t.elapsed());
    // model parity on given features
    let x: Vec<[f32; 5]> = d["x"].as_array().unwrap().iter().map(|r| { let v: Vec<f32> = r.as_array().unwrap().iter().map(|z| z.as_f64().unwrap() as f32).collect(); [v[0], v[1], v[2], v[3], v[4]] }).collect();
    let t = std::time::Instant::now();
    let y = m.run_features(&x).unwrap();
    println!("run {} frames {:?}", x.len(), t.elapsed());
    let want = d["y"].as_array().unwrap();
    let mut md = 0f32;
    for (i, r) in y.iter().enumerate() { for (k, v) in r.iter().enumerate() { md = md.max((v - want[i][k].as_f64().unwrap() as f32).abs()); } }
    println!("frames {} vs {}, max |diff| {md:e}", y.len(), want.len());
    // preprocessing parity
    if let Some(inks) = d["inks"].as_array() {
        let mut worst = 0f32;
        for ink in inks {
            let strokes: Vec<Vec<(f64, f64)>> = ink["strokes"].as_array().unwrap().iter().map(|s| s.as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect()).collect();
            let f = inkcore::inkmath::features(&inkcore::inkmath::coarse(&strokes));
            let w = ink["feat"].as_array().unwrap();
            if f.len() != w.len() { println!("LEN MISMATCH {} vs {}", f.len(), w.len()); worst = f32::MAX; continue; }
            for (r, wr) in f.iter().zip(w) { for k in 0..5 { worst = worst.max((r[k] - wr[k].as_f64().unwrap() as f32).abs()); } }
        }
        println!("features of {} inks: max |diff| {worst:e}", inks.len());
    }
}
