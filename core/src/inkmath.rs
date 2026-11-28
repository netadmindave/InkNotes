//! InkMath: the trained ink → LaTeX recogniser (see train/inkmath.py).
//! Preprocessing here must match `coarse` and `features` in train/inkmath.py exactly.

use serde_json::Value;
use tract_onnx::prelude::*;

pub const COARSE: f64 = 0.03;
pub const STEP: f64 = 0.06;
pub const MAXP: usize = 1600;

fn scale(strokes: &[Vec<(f64, f64)>]) -> (f64, f64, f64) {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for s in strokes { for &(x, y) in s { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); } }
    let s = (y1 - y0).max(0.15 * (x1 - x0)).max(1e-6);
    (x0, y0, s)
}

/// Uniform arclength resampling (same rule as numpy `resample`): samples at 0, step, 2·step … along each stroke,
/// plus the last point if it is more than 0.3·step past the last sample.  Output: x, y, stroke-start flag.
pub fn resample(strokes: &[Vec<(f64, f64)>], step: f64) -> Vec<[f64; 3]> {
    let mut out = vec![];
    for s in strokes {
        if s.is_empty() { continue; }
        let mut c = vec![0.0f64; s.len()];
        for i in 1..s.len() { c[i] = c[i - 1] + (s[i].0 - s[i - 1].0).hypot(s[i].1 - s[i - 1].1); }
        let total = c[s.len() - 1];
        let k = (total / step + 1e-9).floor() as usize;
        let mut a = 0usize;
        let mut last = 0.0;
        for j in 0..=k {
            let t = j as f64 * step;
            last = t;
            while a + 2 < s.len() && c[a + 1] < t { a += 1; }
            let (x, y) = if s.len() == 1 || t <= 0.0 { s[0] } else if t >= total { s[s.len() - 1] } else {
                let (ca, cb) = (c[a], c[a + 1]);
                if cb <= ca { s[a] } else { let f = (t - ca) / (cb - ca); (s[a].0 + f * (s[a + 1].0 - s[a].0), s[a].1 + f * (s[a + 1].1 - s[a].1)) }
            };
            out.push([x, y, if j == 0 { 1.0 } else { 0.0 }]);
        }
        if total - last > 0.3 * step { let l = s[s.len() - 1]; out.push([l.0, l.1, 0.0]); }
    }
    out
}

fn split3(p: &[[f64; 3]]) -> Vec<Vec<(f64, f64)>> {
    let mut out: Vec<Vec<(f64, f64)>> = vec![];
    for q in p { if q[2] > 0.5 || out.is_empty() { out.push(vec![]); } out.last_mut().unwrap().push((q[0], q[1])); }
    out
}

/// Raw strokes → normalised coarse points (what training stores; values rounded to f32 like the cache).
pub fn coarse(strokes: &[Vec<(f64, f64)>]) -> Vec<[f64; 3]> {
    let st: Vec<Vec<(f64, f64)>> = strokes.iter().filter(|s| !s.is_empty()).cloned().collect();
    if st.is_empty() { return vec![]; }
    let (x0, y0, s) = scale(&st);
    let st: Vec<Vec<(f64, f64)>> = st.iter().map(|a| a.iter().map(|&(x, y)| ((x - x0) / s, (y - y0) / s)).collect()).collect();
    resample(&st, COARSE).into_iter().map(|q| [q[0] as f32 as f64, q[1] as f32 as f64, q[2]]).collect()
}

/// Coarse points → model input rows: dx/step, dy/step, y, stroke start, stroke end.
pub fn features(p: &[[f64; 3]]) -> Vec<[f32; 5]> {
    let st = split3(p);
    if st.is_empty() { return vec![[0.0; 5]]; }
    let (x0, y0, s) = scale(&st);
    let st: Vec<Vec<(f64, f64)>> = st.iter().map(|a| a.iter().map(|&(x, y)| ((x - x0) / s, (y - y0) / s)).collect()).collect();
    let length: f64 = st.iter().map(|a| a.windows(2).map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)).sum::<f64>()).sum();
    let mut step = STEP;
    if length / step + st.len() as f64 > MAXP as f64 { step = (length + 1e-6) / (MAXP - st.len() - 2) as f64; }
    let q = resample(&st, step);
    let q: Vec<[f32; 3]> = q.iter().map(|v| [v[0] as f32, v[1] as f32, v[2] as f32]).collect();
    let n = q.len();
    let mut f = vec![[0.0f32; 5]; n];
    for i in 0..n {
        if i > 0 {
            f[i][0] = ((q[i][0] - q[i - 1][0]) / step as f32).clamp(-8.0, 8.0);
            f[i][1] = ((q[i][1] - q[i - 1][1]) / step as f32).clamp(-8.0, 8.0);
        }
        f[i][2] = q[i][1];
        f[i][3] = q[i][2];
        f[i][4] = if i + 1 < n { q[i + 1][2] } else { 1.0 };
    }
    f
}

/* ---------------- LaTeX canonical tokens (same as canon() in inkmath.py) ---------------- */

const DROP: [&str; 16] = ["\\left", "\\right", "\\,", "\\;", "\\!", "\\ ", "\\quad", "\\qquad", "\\displaystyle", "\\limits", "\\nolimits", "\\:", "\\big", "\\Big", "\\bigg", "\\Bigg"];
fn syn(t: &str) -> &str {
    match t {
        "\\le" => "\\leq", "\\ge" => "\\geq", "\\ne" => "\\neq", "\\dfrac" | "\\tfrac" => "\\frac", "\\lbrace" => "\\{", "\\rbrace" => "\\}",
        "\\to" => "\\rightarrow", "\\gets" => "\\leftarrow", "\\varepsilon" => "\\epsilon", "\\vartheta" => "\\theta", "\\varphi" => "\\phi",
        "\\lvert" | "\\rvert" | "\\vert" => "|", "\\ast" => "*", "−" => "-", "×" => "\\times", "·" => "\\cdot", o => o,
    }
}

pub fn tokens(latex: &str) -> Vec<String> {
    let cs: Vec<char> = latex.chars().collect();
    let mut out = vec![];
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() { i += 1; continue; }
        if c == '\\' && i + 1 < cs.len() {
            if cs[i + 1].is_ascii_alphabetic() {
                let mut j = i + 1;
                while j < cs.len() && cs[j].is_ascii_alphabetic() { j += 1; }
                out.push(cs[i..j].iter().collect());
                i = j;
            } else { out.push(cs[i..i + 2].iter().collect()); i += 2; }
            continue;
        }
        out.push(c.to_string());
        i += 1;
    }
    out
}

pub fn canon(latex: &str) -> Vec<String> {
    let t: Vec<String> = tokens(latex).into_iter().filter(|x| !DROP.contains(&x.as_str())).map(|x| syn(&x).to_string()).collect();
    let mut out = vec![];
    let mut i = 0;
    while i < t.len() {
        out.push(t[i].clone());
        if (t[i] == "^" || t[i] == "_") && i + 1 < t.len() && t[i + 1] != "{" {
            out.push("{".into()); out.push(t[i + 1].clone()); out.push("}".into());
            i += 2; continue;
        }
        i += 1;
    }
    out
}

/* ---------------- model ---------------- */

pub struct InkMath {
    plan: std::sync::Arc<TypedRunnableModel>,
    vocab: Vec<String>,
}

pub struct Reading { pub tokens: Vec<String>, pub latex: String, pub conf: f32 }

impl InkMath {
    pub fn load(onnx: &[u8], vocab_json: &str) -> TractResult<Self> {
        let v: Value = serde_json::from_str(vocab_json)?;
        let vocab: Vec<String> = v["tokens"].as_array().ok_or_else(|| anyhow::anyhow!("vocab"))?.iter().map(|t| t.as_str().unwrap_or("").to_string()).collect();
        let mut model = tract_onnx::onnx().model_for_read(&mut std::io::Cursor::new(onnx))?;
        let t = model.symbols.sym("T");
        model.set_input_fact(0, f32::fact(&[1.to_dim(), t.to_dim(), 5.to_dim()]).into())?;
        let plan = model.into_optimized()?.into_runnable()?;
        Ok(InkMath { plan, vocab })
    }

    pub fn run_features(&self, f: &[[f32; 5]]) -> TractResult<Vec<Vec<f32>>> {
        let flat: Vec<f32> = f.iter().flat_map(|r| r.iter().copied()).collect();
        let x: Tensor = tract_ndarray::Array3::from_shape_vec((1, f.len(), 5), flat)?.into();
        let out = self.plan.run(tvec!(x.into()))?;
        let a = out[0].to_plain_array_view::<f32>()?;
        let (u, v) = (a.shape()[1], a.shape()[2]);
        Ok((0..u).map(|i| (0..v).map(|k| a[[0, i, k]]).collect()).collect())
    }

    pub fn recognize(&self, strokes: &[Vec<(f64, f64)>]) -> TractResult<Reading> {
        let f = features(&coarse(strokes));
        let lp = self.run_features(&f)?;
        let (mut toks, mut conf, mut prev) = (vec![], 1.0f32, 0usize);
        for row in &lp {
            let (k, m) = row.iter().enumerate().fold((0, f32::MIN), |b, (i, &x)| if x > b.1 { (i, x) } else { b });
            if k != prev && k != 0 { toks.push(self.vocab[k].clone()); conf = conf.min(m.exp()); }
            prev = k;
        }
        let latex = join_latex(&toks);
        Ok(Reading { tokens: toks, latex, conf })
    }
}

/// tokens → LaTeX text (spaces only where a command would otherwise run into a letter)
pub fn join_latex(t: &[String]) -> String {
    let mut s = String::new();
    for x in t {
        if s.ends_with(|c: char| c.is_ascii_alphabetic()) && s.rfind('\\').map(|p| s[p + 1..].chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false)
            && x.starts_with(|c: char| c.is_ascii_alphabetic()) { s.push(' '); }
        s.push_str(x);
    }
    s
}
