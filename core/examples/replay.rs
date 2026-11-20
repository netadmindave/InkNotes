//! Replays exported training attempts through the formula engine.
//! Character reading is replayed from what was recorded (each stroke keeps the symbol it was read as);
//! layout (lines, grouping, scripts, fractions, limits) is computed fresh, so layout fixes can be checked
//! against real handwriting.   cargo run --example replay -- tests/data/<file>.json [index]
use inkcore::model::Stroke;
use inkcore::recognize::{Job, split_lines, char_height};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let only: Option<usize> = args.get(2).and_then(|s| s.parse().ok());
    let (mut ok, mut n) = (0, 0);
    for (ri, r) in d["records"].as_array().unwrap().iter().enumerate() {
        if r["kind"] != "formula" { continue; }
        if only.map(|o| o != ri).unwrap_or(false) { continue; }
        let strokes: Vec<Stroke> = serde_json::from_value(r["strokes"].clone()).unwrap();
        // stroke -> label from the recording (corrected with the expected glyphs when they pair up 1:1)
        let mut label = vec![String::from("?"); strokes.len()];
        let syms = r["syms"].as_array().cloned().unwrap_or_default();
        let glyphs: Vec<String> = r["glyphs"].as_array().map(|a| a.iter().map(|g| g.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        let fixed = corrected(&syms, &glyphs, &strokes);
        for (si, s) in syms.iter().enumerate() {
            for k in s["strokes"].as_array().unwrap() { label[k.as_u64().unwrap() as usize] = fixed.get(si).cloned().unwrap_or_else(|| s["ch"].as_str().unwrap().to_string()); }
        }
        let mut job = Job::new(strokes.clone(), "math");
        while let Some(reqs) = job.requests().cloned() {
            let ans = reqs.iter().map(|q| {
                let mut found: Vec<(f32, usize)> = vec![];
                for rs in &q.strokes {
                    for (k, st) in strokes.iter().enumerate() {
                        if st.p.len() == rs.len() && st.p.iter().zip(rs).all(|(a, b)| (a.x - b[0] - q.origin.0).abs() < 0.2 && (a.y - b[1] - q.origin.1).abs() < 0.2) {
                            let x0 = st.p.iter().map(|p| p.x).fold(f32::MAX, f32::min);
                            found.push((x0, k)); break;
                        }
                    }
                }
                found.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                // one label per recorded symbol
                let mut seen = vec![]; let mut out = String::new();
                for (_, k) in found { let sid = sym_of(&syms, k); if !seen.contains(&sid) { seen.push(sid); out.push_str(&tok_char(&label[k])); } }
                vec![out]
            }).collect();
            job.feed(ans);
        }
        let got: Vec<String> = job.result().iter().map(|c| c.src.clone()).collect();
        let got = got.join(" | ");
        let want = r["expected"].as_str().unwrap();
        let good = norm(&got) == norm(want);
        n += 1; if good { ok += 1; }
        println!("{:>2} {} want {:<32} got {}   (was {})", ri, if good { "✓" } else { "✗" }, want, got, r["read"].as_str().unwrap());
        if only.is_some() {
            let h = char_height(&strokes);
            println!("   h={h:.1} lines={:?}", split_lines(&strokes));
            for (k, st) in strokes.iter().enumerate() { let b = st.bounds(); println!("   s{k} {:>5} [{:.0},{:.0} {:.0}x{:.0}]", label[k], b.x0, b.y0, b.w(), b.h()); }
        }
    }
    println!("{ok}/{n} read correctly with recorded characters");
}

fn sym_of(syms: &[Value], k: usize) -> usize { syms.iter().position(|s| s["strokes"].as_array().unwrap().iter().any(|x| x.as_u64() == Some(k as u64))).unwrap_or(usize::MAX - k) }

/// tokens back to the single characters a recogniser would return
fn tok_char(t: &str) -> String {
    match t { "pi" => "π", "theta" => "θ", "alpha" => "α", "beta" => "β", "gamma" => "γ", "lambda" => "λ", "nu" => "ν", "omega" => "ω", "sigma" => "σ",
        "phi" => "φ", "psi" => "ψ", "Delta" => "Δ", "Phi" => "Φ", "oo" => "∞", "int" => "∫", "sum" => "∑", "xx" => "×", "<=" => "≤", "-:" => "÷", other => other }.to_string()
}

/// Pair recorded symbols with the expected glyphs (same multiset matching the app uses) to get the true characters.
fn corrected(syms: &[Value], glyphs: &[String], strokes: &[Stroke]) -> Vec<String> {
    let mut idx: Vec<usize> = (0..syms.len()).collect();
    let x0 = |s: &Value| s["strokes"].as_array().unwrap().iter().map(|k| strokes[k.as_u64().unwrap() as usize].bounds().x0).fold(f32::MAX, f32::min);
    idx.sort_by(|&a, &b| x0(&syms[a]).partial_cmp(&x0(&syms[b])).unwrap());
    let mut out: Vec<String> = syms.iter().map(|s| s["ch"].as_str().unwrap().to_string()).collect();
    if glyphs.is_empty() || syms.len() != glyphs.len() { return out; }
    let mut remaining = glyphs.to_vec();
    let mut unmatched = vec![];
    for &i in &idx { if let Some(p) = remaining.iter().position(|g| *g == out[i]) { remaining.remove(p); } else { unmatched.push(i); } }
    for (j, &i) in unmatched.iter().enumerate() { if let Some(g) = remaining.get(j) { out[i] = g.clone(); } }
    out
}

/// Same formula written two ways ("int_(0)^(1)" vs "int_0^1", "(1)/(2)" vs "1/2") compares equal.
fn norm(s: &str) -> String {
    let mut t = s.replace(' ', "");
    let re = regex::Regex::new(r"\(([^()+\-=*/,]+)\)").unwrap();
    loop { let n = re.replace_all(&t, "$1").into_owned(); if n == t { break; } t = n; }
    t
}
