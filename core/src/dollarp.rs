//! Personal handwriting samples, matched with the $P point-cloud recogniser
//! (Vatavu, Anthony & Wobbrock, "Gestures as Point Clouds", ICMI 2012).
//! Sample format is the same as InkNotes 1.x ("hwSamples"), so trained samples carry over.

use crate::model::Stroke;
use std::collections::BTreeMap;
use std::sync::Mutex;

const N: usize = 32;
type Cloud = Vec<[f32; 2]>;

/// [shown symbol, AsciiMath token]
pub const SYMBOLS: &[(&str, &str)] = &[
    // digits
    ("0", "0"), ("1", "1"), ("2", "2"), ("3", "3"), ("4", "4"), ("5", "5"), ("6", "6"), ("7", "7"), ("8", "8"), ("9", "9"),
    // letters
    ("a", "a"), ("b", "b"), ("c", "c"), ("d", "d"), ("e", "e"), ("f", "f"), ("g", "g"), ("h", "h"), ("i", "i"), ("j", "j"), ("k", "k"), ("l", "l"), ("m", "m"), ("n", "n"), ("o", "o"), ("p", "p"), ("q", "q"), ("r", "r"), ("s", "s"), ("t", "t"), ("u", "u"), ("v", "v"), ("w", "w"), ("x", "x"), ("y", "y"), ("z", "z"),
    ("A", "A"), ("B", "B"), ("C", "C"), ("D", "D"), ("E", "E"), ("F", "F"), ("G", "G"), ("H", "H"), ("I", "I"), ("J", "J"), ("K", "K"), ("L", "L"), ("M", "M"), ("N", "N"), ("O", "O"), ("P", "P"), ("Q", "Q"), ("R", "R"), ("S", "S"), ("T", "T"), ("U", "U"), ("V", "V"), ("W", "W"), ("X", "X"), ("Y", "Y"), ("Z", "Z"),
    // Greek
    ("α", "alpha"), ("β", "beta"), ("γ", "gamma"), ("δ", "delta"), ("ε", "epsilon"), ("ζ", "zeta"), ("η", "eta"), ("θ", "theta"),
    ("ι", "iota"), ("κ", "kappa"), ("λ", "lambda"), ("μ", "mu"), ("ν", "nu"), ("ξ", "xi"), ("π", "pi"), ("ρ", "rho"), ("σ", "sigma"),
    ("τ", "tau"), ("υ", "upsilon"), ("φ", "phi"), ("χ", "chi"), ("ψ", "psi"), ("ω", "omega"),
    ("Γ", "Gamma"), ("Δ", "Delta"), ("Θ", "Theta"), ("Λ", "Lambda"), ("Ξ", "Xi"), ("Π", "Pi"), ("Σ", "Sigma"), ("Φ", "Phi"),
    ("Ψ", "Psi"), ("Ω", "Omega"),
    // operators, relations, brackets
    ("+", "+"), ("−", "-"), ("=", "="), ("×", "xx"), ("÷", "-:"), ("·", "*"), ("/", "/"), ("±", "+-"), ("<", "<"), (">", ">"),
    ("≤", "<="), ("≥", ">="), ("≠", "!="), ("≈", "~~"), ("∝", "prop"), ("(", "("), (")", ")"), ("[", "["), ("]", "]"),
    ("{", "{"), ("}", "}"), ("|", "|"), ("!", "!"), ("′", "'"), (",", ","), ("%", "%"), ("°", "@"),
    // calculus and other
    ("∫", "int"), ("∮", "oint"), ("∑", "sum"), ("∏", "prod"), ("√", "sqrt"), ("∞", "oo"), ("∂", "del"), ("∇", "grad"),
    ("→", "->"), ("∈", "in"), ("∀", "AA"), ("∃", "EE"),
];

fn token(sym: &str) -> String { SYMBOLS.iter().find(|s| s.0 == sym).map(|s| s.1.to_string()).unwrap_or_else(|| sym.to_string()) }

static SAMPLES: Mutex<BTreeMap<String, Vec<Cloud>>> = Mutex::new(BTreeMap::new());
/// What the recogniser read → what you actually wrote, with counts (learned from training misreads).
static CONFUSIONS: Mutex<BTreeMap<String, BTreeMap<String, u32>>> = Mutex::new(BTreeMap::new());

pub fn confusions_load(json: &str) { if let Ok(m) = serde_json::from_str(json) { *CONFUSIONS.lock().unwrap() = m; } }
pub fn confusions_save() -> String { serde_json::to_string(&*CONFUSIONS.lock().unwrap()).unwrap_or_else(|_| "{}".into()) }
pub fn confusion_add(read: &str, truth: &str) {
    if read == truth || read.is_empty() || truth.is_empty() { return; }
    *CONFUSIONS.lock().unwrap().entry(read.to_string()).or_default().entry(truth.to_string()).or_insert(0) += 1;
}
pub fn confusions_merge(json: &str) {
    if let Ok(m) = serde_json::from_str::<BTreeMap<String, BTreeMap<String, u32>>>(json) {
        let mut c = CONFUSIONS.lock().unwrap();
        for (r, t) in m { for (k, n) in t { let e = c.entry(r.clone()).or_default().entry(k).or_insert(0); *e = (*e).max(n); } }
    }
}
fn confused(read: &str, truth: &str) -> bool { CONFUSIONS.lock().unwrap().get(read).map(|t| t.contains_key(truth)).unwrap_or(false) }

pub fn load(json: &str) { if let Ok(m) = serde_json::from_str(json) { *SAMPLES.lock().unwrap() = m; } }
/// Add samples from an imported training set ({symbol: [clouds]}), keeping the newest 10 per symbol.
pub fn merge(json: &str) -> usize {
    let Ok(m) = serde_json::from_str::<BTreeMap<String, Vec<Cloud>>>(json) else { return 0 };
    let mut s = SAMPLES.lock().unwrap();
    let mut n = 0;
    for (k, v) in m {
        let e = s.entry(k).or_default();
        for c in v { if c.len() == N && !e.contains(&c) { e.push(c); n += 1; } }
        while e.len() > 10 { e.remove(0); }
    }
    n
}
pub fn save() -> String { serde_json::to_string(&*SAMPLES.lock().unwrap()).unwrap_or_else(|_| "{}".into()) }
pub fn count(sym: &str) -> usize { SAMPLES.lock().unwrap().get(sym).map(|v| v.len()).unwrap_or(0) }
pub fn clear(sym: Option<&str>) { let mut s = SAMPLES.lock().unwrap(); match sym { Some(k) => { s.remove(k); } None => s.clear() } }
fn total() -> usize { SAMPLES.lock().unwrap().values().map(|v| v.len()).sum() }

fn cloud_from(strokes: &[&Stroke]) -> Option<Cloud> {
    let mut pts: Vec<(f32, f32, usize)> = vec![];
    for (id, st) in strokes.iter().enumerate() { for q in &st.p { pts.push((q.x, q.y, id)); } }
    if pts.len() < 2 { return None; }
    // resample along the strokes (gaps between strokes are not path)
    let len: f32 = pts.windows(2).filter(|w| w[0].2 == w[1].2).map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)).sum();
    let step = if len > 0.0 { len / (N as f32 - 1.0) } else { 1.0 };
    let mut out = vec![(pts[0].0, pts[0].1)];
    let mut d_acc = 0.0;
    let mut src = pts.clone();
    let mut i = 1;
    while i < src.len() {
        if src[i].2 == src[i - 1].2 {
            let d = (src[i].0 - src[i - 1].0).hypot(src[i].1 - src[i - 1].1);
            if d_acc + d >= step && d > 0.0 {
                let t = (step - d_acc) / d;
                let q = (src[i - 1].0 + t * (src[i].0 - src[i - 1].0), src[i - 1].1 + t * (src[i].1 - src[i - 1].1), src[i].2);
                out.push((q.0, q.1));
                src.insert(i, q);
                d_acc = 0.0;
            } else { d_acc += d; }
        }
        i += 1;
    }
    while out.len() < N { let l = src.last().unwrap(); out.push((l.0, l.1)); }
    out.truncate(N);
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in &out { x0 = x0.min(p.0); y0 = y0.min(p.1); x1 = x1.max(p.0); y1 = y1.max(p.1); }
    let sz = (x1 - x0).max(y1 - y0).max(1e-3);
    let pts: Vec<(f32, f32)> = out.iter().map(|p| ((p.0 - x0) / sz, (p.1 - y0) / sz)).collect();
    let cx = pts.iter().map(|p| p.0).sum::<f32>() / pts.len() as f32;
    let cy = pts.iter().map(|p| p.1).sum::<f32>() / pts.len() as f32;
    Some(pts.iter().map(|p| [((p.0 - cx) * 1000.0).round() / 1000.0, ((p.1 - cy) * 1000.0).round() / 1000.0]).collect())
}

fn cloud_distance(a: &Cloud, b: &Cloud, start: usize) -> f32 {
    let n = a.len().min(b.len());
    let mut matched = vec![false; n];
    let mut sum = 0.0;
    let mut i = start;
    loop {
        let (mut min, mut idx) = (f32::MAX, 0);
        for j in 0..n { if !matched[j] { let d = (a[i][0] - b[j][0]).hypot(a[i][1] - b[j][1]); if d < min { min = d; idx = j; } } }
        matched[idx] = true;
        let w = 1.0 - ((i + n - start) % n) as f32 / n as f32;
        sum += w * min;
        i = (i + 1) % n;
        if i == start { break; }
    }
    sum
}

fn greedy(a: &Cloud, b: &Cloud) -> f32 {
    let step = ((a.len() as f32).sqrt().floor() as usize).max(1);
    (0..a.len().min(b.len())).step_by(step).map(|i| cloud_distance(a, b, i).min(cloud_distance(b, a, i))).fold(f32::MAX, f32::min)
}

/// Like `classify`, but ignores a template identical to the query (to test honestly on recorded data).
pub fn classify_leave_out(strokes: &[&Stroke]) -> Vec<(String, String, f32)> {
    let Some(c) = cloud_from(strokes) else { return vec![] };
    let s = SAMPLES.lock().unwrap();
    let mut res: Vec<(String, String, f32)> = s.iter().filter_map(|(sym, l)| {
        let d = l.iter().map(|t| greedy(&c, t)).filter(|&d| d > 1e-3).fold(f32::MAX, f32::min);
        if d == f32::MAX { None } else { Some((sym.clone(), token(sym), d)) }
    }).collect();
    res.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
    res
}

/// The override decision for a ranked list (shared by the live path and offline evaluation).
pub fn decide(r: &[(String, String, f32)], current: &str) -> Option<String> {
    let best = r.first()?;
    if best.1 == current { return None; }
    let second = r.iter().find(|x| x.1 != best.1);
    let margin = second.map(|s| s.2 / best.2.max(1e-6)).unwrap_or(9.0);
    let special = !(best.1.len() == 1 && best.1.chars().all(|c| c.is_ascii_alphanumeric()));
    if (special && best.2 < 1.4 && margin > 1.3) || (best.2 < 0.9 && margin > 1.8) || (current == "?" && best.2 < 2.0) { return Some(best.1.clone()); }
    // a mix-up you've had before (π read as T, f as ∫ …): trust your samples when they clearly prefer the other one
    // (tuned on 106 recorded formulas: 12 fixes for 3 breakages, vs 2 fixes without it)
    let cur_d = r.iter().find(|x| x.1 == current).map(|x| x.2).unwrap_or(9.0);
    if confused(current, &best.1) && best.2 < 1.4 && cur_d > 1.2 * best.2 { return Some(best.1.clone()); }
    None
}

/// Best matches: (symbol, token, distance), one per symbol, best first.
pub fn classify(strokes: &[&Stroke]) -> Vec<(String, String, f32)> {
    let Some(c) = cloud_from(strokes) else { return vec![] };
    let s = SAMPLES.lock().unwrap();
    let mut res: Vec<(String, String, f32)> = s.iter().filter(|(_, l)| !l.is_empty())
        .map(|(sym, l)| (sym.clone(), token(sym), l.iter().map(|t| greedy(&c, t)).fold(f32::MAX, f32::min))).collect();
    res.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
    res
}

pub fn add_sample(sym: &str, strokes: &[&Stroke]) -> bool {
    let Some(c) = cloud_from(strokes) else { return false };
    let mut s = SAMPLES.lock().unwrap();
    let v = s.entry(sym.to_string()).or_default();
    v.push(c);
    if v.len() > 10 { v.remove(0); }
    true
}

/// Token to use instead of the recogniser's reading, if the user's samples clearly say otherwise.
/// Matches score ~0.3–0.7, different symbols ~1.5+; letters/digits need a clearer win.
pub fn override_for(strokes: &[&Stroke], current: &str) -> Option<String> {
    if total() == 0 { return None; }
    decide(&classify(strokes), current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Pt;
    fn st(pts: &[(f32, f32)], jit: f32, seed: u32) -> Stroke {
        let mut s = seed;
        let mut p = vec![];
        for w in pts.windows(2) { for k in 0..8 { let t = k as f32 / 8.0;
            s = s.wrapping_mul(1103515245).wrapping_add(12345); let a = ((s >> 16) % 1000) as f32 / 1000.0 - 0.5;
            p.push(Pt::new(w[0].0 + (w[1].0 - w[0].0) * t + a * jit, w[0].1 + (w[1].1 - w[0].1) * t - a * jit)); } }
        Stroke { c: String::new(), s: 2.0, k: String::new(), d: String::new(), g: 0, cut: 0, p, rt: None }
    }
    #[test]
    fn learns_symbols() {
        clear(None);
        let pi = |sc: f32, sd: u32| vec![st(&[(0.0, 0.0), (30.0 * sc, -1.0)], 2.0, sd), st(&[(8.0 * sc, 0.0), (6.0 * sc, 26.0 * sc)], 2.0, sd + 1), st(&[(22.0 * sc, 0.0), (24.0 * sc, 26.0 * sc)], 2.0, sd + 2)];
        let inf = |sd: u32| vec![st(&[(0.0, 6.0), (7.0, 0.0), (13.0, 6.0), (20.0, 12.0), (26.0, 6.0), (20.0, 0.0), (13.0, 6.0), (7.0, 12.0), (0.0, 6.0)], 1.5, sd)];
        for k in 0..3 { add_sample("π", &pi(1.0, k * 7).iter().collect::<Vec<_>>()); add_sample("∞", &inf(k * 3).iter().collect::<Vec<_>>()); }
        let r = classify(&pi(1.6, 99).iter().collect::<Vec<_>>());
        assert_eq!(r[0].0, "π");
        assert!(r[0].2 < r[1].2);
        assert_eq!(override_for(&inf(77).iter().collect::<Vec<_>>(), "a").as_deref(), Some("oo"));
        let back = save();
        clear(None);
        load(&back);
        assert_eq!(count("π"), 3);
        clear(None);
    }
}

#[cfg(test)]
mod confusion_tests {
    use super::*;
    #[test]
    fn learned_confusion_allows_override() {
        let r = vec![("π".to_string(), "pi".to_string(), 1.2f32), ("T".to_string(), "T".to_string(), 1.5)];
        assert_eq!(decide(&r, "T"), None);
        confusion_add("T", "pi");
        assert_eq!(decide(&r, "T").as_deref(), Some("pi"));
        assert!(confusions_save().contains("pi"));
    }
}
