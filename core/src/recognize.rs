//! Handwriting → text / formula. Character reading is done by Google ML Kit on the Android side;
//! this module does the page analysis around it: lines, formula layout (fractions, roots, scripts,
//! ∫/∑ limits), symbol clean-up, and AsciiMath output.
//!
//! It is a small state machine because ML Kit is asynchronous:
//!   let mut job = Job::new(strokes, mode);
//!   while let Some(req) = job.requests() { job.feed(recognise(req)); }
//!   job.result()

use crate::dollarp;
use crate::model::{Rect, Stroke};
use serde::Serialize;

/* ---------------- geometry helpers ---------------- */

fn median(mut v: Vec<f32>) -> f32 {
    if v.is_empty() { return 0.0; }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}
fn is_flat(b: &Rect, h: f32) -> bool { b.w() >= 0.35 * h && b.h() <= 0.32 * b.w() && b.h() <= 0.45 * h }
fn is_dot(b: &Rect, h: f32) -> bool { b.w() < 0.22 * h && b.h() < 0.22 * h }

pub fn char_height(strokes: &[Stroke]) -> f32 {
    let bs: Vec<Rect> = strokes.iter().map(|s| s.bounds()).collect();
    let hs: Vec<f32> = bs.iter().filter(|b| b.h() > 2.0 && b.h() > 0.35 * b.w()).map(|b| b.h()).collect();
    let m = median(hs);
    let m = if m > 0.0 { m } else { median(bs.iter().map(|b| b.h().max(b.w())).collect()) };
    (if m > 0.0 { m } else { 24.0 }).max(12.0)
}

/* ---------------- lines ---------------- */

/// Group strokes into lines (indices), top to bottom, each sorted left to right.
pub fn split_lines(strokes: &[Stroke]) -> Vec<Vec<usize>> {
    if strokes.is_empty() { return vec![]; }
    let h = char_height(strokes);
    let bs: Vec<Rect> = strokes.iter().map(|s| s.bounds()).collect();
    let mut order: Vec<usize> = (0..strokes.len()).collect();
    order.sort_by(|&a, &b| bs[a].y0.partial_cmp(&bs[b].y0).unwrap());
    struct L { items: Vec<usize>, y0: f32, y1: f32 }
    let mut lines: Vec<L> = vec![];
    for &i in &order {
        let b = bs[i];
        let mut best: Option<usize> = None;
        let mut best_ov = f32::MIN;
        for (li, l) in lines.iter().enumerate() {
            let ov = l.y1.min(b.y1) - l.y0.max(b.y0);
            let need = b.h().min(l.y1 - l.y0) * 0.25;
            let near = b.h() < 0.75 * h && (b.y0 - l.y1) < 0.35 * h && (l.y0 - b.y1) < 0.35 * h;
            if (ov > need || near) && (best.is_none() || ov > best_ov) { best = Some(li); best_ov = ov; }
        }
        match best {
            Some(li) => { let l = &mut lines[li]; l.items.push(i); l.y0 = l.y0.min(b.y0); l.y1 = l.y1.max(b.y1); }
            None => lines.push(L { items: vec![i], y0: b.y0, y1: b.y1 }),
        }
    }
    // lines of only small glyphs (exponents, subscripts, limits) join the nearest line
    loop {
        let mut merged = false;
        for li in 0..lines.len() {
            if lines[li].items.iter().any(|&i| bs[i].h() >= 0.75 * h && !is_flat(&bs[i], h)) { continue; }
            let mut best: Option<usize> = None;
            let mut best_gap = f32::MAX;
            for mi in 0..lines.len() {
                if mi == li { continue; }
                let gap = (lines[mi].y0 - lines[li].y1).max(lines[li].y0 - lines[mi].y1).max(0.0);
                let x_near = lines[mi].items.iter().any(|&o| lines[li].items.iter().any(|&i| (bs[o].cx() - bs[i].cx()).abs() < bs[o].w().max(bs[i].w()) / 2.0 + 1.2 * h));
                if gap < 0.45 * h && x_near && gap < best_gap { best = Some(mi); best_gap = gap; }
            }
            if let Some(mi) = best {
                let l = lines.remove(li);
                let mi = if mi > li { mi - 1 } else { mi };
                let m = &mut lines[mi];
                m.items.extend(l.items); m.y0 = m.y0.min(l.y0); m.y1 = m.y1.max(l.y1);
                merged = true;
                break;
            }
        }
        if !merged { break; }
    }
    // a short raised group (exponent like ¹⁶) just above the end of a line belongs to that line
    loop {
        let mut merged = false;
        for li in 0..lines.len() {
            if lines[li].items.len() > 4 { continue; }
            let (ax0, ax1) = lines[li].items.iter().fold((f32::MAX, f32::MIN), |(a, b), &i| (a.min(bs[i].x0), b.max(bs[i].x1)));
            let ah = lines[li].y1 - lines[li].y0;
            let target = (0..lines.len()).find(|&mi| {
                if mi == li { return false; }
                let m = &lines[mi];
                let (mx0, mx1) = m.items.iter().fold((f32::MAX, f32::MIN), |(a, b), &i| (a.min(bs[i].x0), b.max(bs[i].x1)));
                let gap = m.y0 - lines[li].y1;
                gap < 0.3 * h && lines[li].y1 < (m.y0 + m.y1) / 2.0 && ah < 0.8 * (m.y1 - m.y0)
                    && ax0 > mx0 && ax0 < mx1 + 1.5 * h && ax1 < mx1 + 4.0 * h
            });
            if let Some(mi) = target {
                let l = lines.remove(li);
                let mi = if mi > li { mi - 1 } else { mi };
                let m = &mut lines[mi];
                m.items.extend(l.items); m.y0 = m.y0.min(l.y0); m.y1 = m.y1.max(l.y1);
                merged = true;
                break;
            }
        }
        if !merged { break; }
    }
    // a fraction bar glues the line above and the line below together
    loop {
        let mut merged = false;
        'outer: for li in 0..lines.len() {
            for &bar in &lines[li].items {
                let bb = bs[bar];
                if !is_flat(&bb, h) || bb.w() < 0.9 * h { continue; }
                let touches = |m: &L, above: bool| m.items.iter().any(|&o| o != bar && bs[o].cx() > bb.x0 - 0.1 * h && bs[o].cx() < bb.x1 + 0.1 * h &&
                    if above { bb.cy() - bs[o].y1 < 0.9 * h && bs[o].cy() < bb.cy() } else { bs[o].y0 - bb.cy() < 0.9 * h && bs[o].cy() > bb.cy() });
                let up = lines.iter().position(|m| touches(m, true));
                let dn = lines.iter().position(|m| touches(m, false));
                if let (Some(u), Some(d)) = (up, dn) {
                    if u != li || d != li {
                        let mut take: Vec<usize> = [u, d].into_iter().filter(|&x| x != li).collect();
                        take.sort_unstable(); take.dedup();
                        let mut add = vec![];
                        let (mut y0, mut y1) = (lines[li].y0, lines[li].y1);
                        for &t in take.iter().rev() { let m = lines.remove(t); y0 = y0.min(m.y0); y1 = y1.max(m.y1); add.extend(m.items); }
                        let li2 = li - take.iter().filter(|&&t| t < li).count();
                        let l = &mut lines[li2];
                        l.items.extend(add); l.y0 = y0; l.y1 = y1;
                        merged = true;
                        break 'outer;
                    }
                }
            }
        }
        if !merged { break; }
    }
    lines.sort_by(|a, b| a.y0.partial_cmp(&b.y0).unwrap());
    lines.into_iter().map(|mut l| { l.items.sort_by(|&a, &b| bs[a].x0.partial_cmp(&bs[b].x0).unwrap()); l.items }).collect()
}

/* ---------------- formula structure ---------------- */

#[derive(Clone, Debug)]
pub struct Sym { pub strokes: Vec<usize>, pub b: Rect, pub ch: String }

#[derive(Clone, Debug)]
pub enum Node { Sym(usize), Frac(Vec<Node>, Vec<Node>, Rect), Sqrt(Vec<Node>, Rect) }

struct Layout<'a> { strokes: &'a [Stroke], bs: Vec<Rect>, h: f32, syms: Vec<Sym> }

impl<'a> Layout<'a> {
    fn node_b(&self, n: &Node) -> Rect { match n { Node::Sym(i) => self.syms[*i].b, Node::Frac(_, _, b) | Node::Sqrt(_, b) => *b } }
    fn union(&self, ids: &[usize]) -> Rect { let mut r = Rect::empty(); for &i in ids { r.union(&self.bs[i]); } r }

    fn radical_contents(&self, st: usize, others: &[usize]) -> Option<Vec<usize>> {
        let b = self.bs[st];
        let h = self.h;
        if b.w() < 0.8 * h || b.h() < 0.6 * h || b.w() < 0.75 * b.h() { return None; }
        let pts = &self.strokes[st].p;
        let right: Vec<_> = pts.iter().filter(|q| q.x > b.x0 + 0.55 * b.w()).collect();
        if right.len() < 2 { return None; }
        let rr = Rect::of_points(right.iter().map(|q| (q.x, q.y)));
        if rr.h() > 0.15 * b.h() + 3.0 || rr.y0 - b.y0 > 0.15 * b.h() + 3.0 || rr.w() < 0.3 * b.w() { return None; }
        let (li, low) = pts.iter().enumerate().fold((0, pts[0]), |acc, (i, q)| if q.y > acc.1.y { (i, *q) } else { acc });
        if low.x > b.x0 + 0.5 * b.w() { return None; }
        if (li as f32) < 0.08 * pts.len() as f32 || (li as f32) > 0.9 * pts.len() as f32 { return None; }
        let inside: Vec<usize> = others.iter().copied().filter(|&o| {
            let ob = self.bs[o];
            o != st && ob.x0 > b.x0 + 0.2 * b.w() && ob.cx() > b.x0 + 0.25 * b.w() && ob.cx() < b.x1 + 0.1 * h && ob.cy() > b.y0 && ob.cy() < b.y1 + 0.1 * h
        }).collect();
        if inside.is_empty() { None } else { Some(inside) }
    }

    fn structure(&mut self, ids: &[usize]) -> Vec<Node> {
        let h = self.h;
        let mut rest: Vec<usize> = ids.to_vec();
        let mut nodes = vec![];
        let mut bars: Vec<usize> = rest.iter().copied().filter(|&s| is_flat(&self.bs[s], h) && self.bs[s].w() >= 0.9 * h).collect();
        bars.sort_by(|&a, &b| self.bs[b].w().partial_cmp(&self.bs[a].w()).unwrap());
        for bar in bars {
            if !rest.contains(&bar) { continue; }
            let bb = self.bs[bar];
            let in_span = |o: usize, bs: &Vec<Rect>| o != bar && bs[o].cx() > bb.x0 - 0.1 * h && bs[o].cx() < bb.x1 + 0.1 * h;
            let num: Vec<usize> = rest.iter().copied().filter(|&o| in_span(o, &self.bs) && self.bs[o].cy() < bb.cy() && bb.cy() - self.bs[o].y1 < 2.4 * h).collect();
            let den: Vec<usize> = rest.iter().copied().filter(|&o| in_span(o, &self.bs) && self.bs[o].cy() > bb.cy() && self.bs[o].y0 - bb.cy() < 2.4 * h).collect();
            if num.is_empty() || den.is_empty() { continue; }
            let mut all = num.clone(); all.extend(&den); all.push(bar);
            rest.retain(|o| !all.contains(o));
            let b = self.union(&all);
            let n = self.structure(&num);
            let d = self.structure(&den);
            nodes.push(Node::Frac(n, d, b));
        }
        let mut by_w = rest.clone();
        by_w.sort_by(|&a, &b| self.bs[b].w().partial_cmp(&self.bs[a].w()).unwrap());
        for st in by_w {
            if !rest.contains(&st) { continue; }
            if let Some(inside) = self.radical_contents(st, &rest) {
                rest.retain(|o| *o != st && !inside.contains(o));
                let mut all = inside.clone(); all.push(st);
                let b = self.union(&all);
                let body = self.structure(&inside);
                nodes.push(Node::Sqrt(body, b));
            }
        }
        rest.sort_by(|&a, &b| self.bs[a].x0.partial_cmp(&self.bs[b].x0).unwrap());
        let mut group: Vec<usize> = vec![];
        for st in rest {
            let b = self.bs[st];
            if let Some(&last) = group.last() {
                let l = self.syms[last].b;
                let ov = l.x1.min(b.x1) - l.x0.max(b.x0);
                let narrow = l.w().min(b.w()).max(1.0);
                let dot_over = is_dot(&b, h) && b.cx() > l.x0 - 0.15 * h && b.cx() < l.x1 + 0.15 * h && b.y1 < l.y0 + 0.2 * h;
                let stacked = is_flat(&b, h) && is_flat(&l, h) && ov > 0.5 * narrow;
                let vgap = (b.y0 - l.y1).max(l.y0 - b.y1).max(0.0);
                let center_in = (b.cx() >= l.x0 - 1.0 && b.cx() <= l.x1 + 1.0) || (l.cx() >= b.x0 - 1.0 && l.cx() <= b.x1 + 1.0);
                let (big, sm) = if l.w().max(l.h()) > b.w().max(b.h()) { (l, b) } else { (b, l) };
                let y_ov = big.y1.min(sm.y1) - big.y0.max(sm.y0);
                let separate = big.w().max(big.h()) > 2.2 * sm.w().max(sm.h()) && y_ov < 0.5 * sm.h();
                if !separate && (((ov > 0.45 * narrow || center_in) && vgap < 0.3 * h) || dot_over || stacked) {
                    let s = &mut self.syms[last];
                    s.strokes.push(st);
                    s.b.union(&b);
                    continue;
                }
            }
            self.syms.push(Sym { strokes: vec![st], b, ch: String::new() });
            group.push(self.syms.len() - 1);
        }
        nodes.extend(group.into_iter().map(Node::Sym));
        nodes.sort_by(|a, b| self.node_b(a).x0.partial_cmp(&self.node_b(b).x0).unwrap());
        nodes
    }
}

/* ---------------- symbol choice ---------------- */

pub fn map_char(t: &str) -> Option<&'static str> {
    Some(match t {
        "×" | "✕" => "xx", "÷" => "-:", "−" | "–" | "—" => "-", "·" | "•" => "*", "∞" => "oo", "π" => "pi", "Σ" | "∑" => "sum",
        "∫" => "int", "√" => "sqrt", "≤" => "<=", "≥" => ">=", "≠" => "!=", "±" => "+-", "→" => "->", "≈" => "~~",
        "α" => "alpha", "β" => "beta", "γ" => "gamma", "δ" => "delta", "Δ" => "Delta", "θ" => "theta", "λ" => "lambda",
        "μ" => "mu", "σ" => "sigma", "φ" => "phi", "ω" => "omega", "Ω" => "Omega", "∂" => "del", "∇" => "grad", "°" => "@",
        "′" | "’" | "‘" => "'", "“" | "”" => "\"",
        _ => return None,
    })
}
fn ok1(t: &str) -> bool {
    let mut c = t.chars();
    matches!((c.next(), c.next()), (Some(ch), None) if ch.is_ascii_alphanumeric() || "+-=()[].,<>/|!'*:".contains(ch))
}

fn seg_intersect(a: (f32, f32), b: (f32, f32), c: (f32, f32), d: (f32, f32)) -> bool {
    let o = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    o(a, b, c) * o(a, b, d) < 0.0 && o(c, d, a) * o(c, d, b) < 0.0
}

fn is_plus(l: &Layout, s: &Sym) -> bool {
    if s.strokes.len() != 2 { return false; }
    let (b1, b2) = (l.bs[s.strokes[0]], l.bs[s.strokes[1]]);
    let hz = if b1.w() > 1.8 * b1.h() { Some(b1) } else if b2.w() > 1.8 * b2.h() { Some(b2) } else { None };
    let vt = if b1.h() > 1.8 * b1.w() { Some(b1) } else if b2.h() > 1.8 * b2.w() { Some(b2) } else { None };
    let (Some(hz), Some(vt)) = (hz, vt) else { return false };
    if hz == vt { return false; }
    let r = hz.w() / vt.h().max(1e-3);
    if !(0.45..=2.2).contains(&r) { return false; }
    let fx = (vt.cx() - hz.x0) / hz.w().max(1e-3);
    let fy = (hz.cy() - vt.y0) / vt.h().max(1e-3);
    fx > 0.25 && fx < 0.75 && fy > 0.3 && fy < 0.72
}

fn is_infinity(l: &Layout, s: &Sym) -> bool {
    let b = s.b;
    // ∞ is one looping stroke; an x is two crossing strokes (and must never become ∞)
    if s.strokes.len() != 1 { return false; }
    if b.w() < 1.25 * b.h() || b.w() > 4.5 * b.h() || b.h() < 0.15 * l.h { return false; }
    let pts: Vec<(f32, f32)> = s.strokes.iter().flat_map(|&i| l.strokes[i].p.iter().map(|q| (q.x, q.y))).collect();
    let gap = 4.max(pts.len() / 5);
    for i in 0..pts.len() {
        if (pts[i].0 - b.cx()).abs() > 0.2 * b.w() { continue; }
        for j in (i + gap)..pts.len() {
            if (pts[i].0 - pts[j].0).hypot(pts[i].1 - pts[j].1) < 0.07 * b.w() + 1.0 { return true; }
        }
    }
    for i in 0..pts.len().saturating_sub(1) {
        for j in (i + 3)..pts.len().saturating_sub(1) {
            if seg_intersect(pts[i], pts[i + 1], pts[j], pts[j + 1]) && ((pts[i].0 + pts[i + 1].0) / 2.0 - b.cx()).abs() < 0.25 * b.w() { return true; }
        }
    }
    false
}

fn refine(l: &Layout, pick: &str, s: &Sym) -> String {
    let b = s.b;
    let h = l.h;
    if is_plus(l, s) { return "+".into(); }
    if is_infinity(l, s) && !(pick.len() == 1 && pick.chars().all(|c| c.is_ascii_digit())) && !["x", "X", "xx", "×"].contains(&pick) { return "oo".into(); }
    if s.strokes.len() == 1 && is_flat(&b, h) { return "-".into(); }
    let mut pick = pick.to_string();
    if pick == "_" { pick = "-".into(); }
    if b.h() > 1.7 * h && ["S", "s", "f", "ʃ", "int"].contains(&pick.as_str()) && b.w() < 0.7 * b.h() { pick = "int".into(); }
    else if b.h() > 1.7 * h && ["E", "Σ", "sum"].contains(&pick.as_str()) { pick = "sum".into(); }
    if pick.len() == 1 && "CKOPSUVWXZ".contains(pick.as_str()) && b.h() < 0.72 * h { pick = pick.to_lowercase(); }
    pick
}

fn choose(l: &Layout, cands: &[String], s: &Sym) -> String {
    let h = l.h;
    if s.strokes.len() == 1 && is_flat(&s.b, h) { return "-".into(); }
    if s.strokes.len() == 2 && s.strokes.iter().all(|&i| is_flat(&l.bs[i], h)) { return "=".into(); }
    if s.strokes.len() == 1 && is_dot(&s.b, h) { return ".".into(); }
    let mut pick: Option<String> = None;
    for c in cands {
        let t = c.trim();
        if t.is_empty() { continue; }
        if let Some(m) = map_char(t) { pick = Some(m.into()); break; }
        if t.chars().count() > 1 {
            if t.chars().all(|c| c.is_ascii_digit()) || (t.len() == 1 && t.chars().all(|c| c.is_ascii_alphabetic())) { pick = Some(t.into()); break; }
            continue;
        }
        if ok1(t) { pick = Some(t.into()); break; }
    }
    let pick = pick.unwrap_or_else(|| cands.first().and_then(|c| c.trim().chars().next()).map(|c| c.to_string()).unwrap_or_else(|| "?".into()));
    refine(l, &pick, s)
}

/* ---------------- layout → AsciiMath ---------------- */

const BIGOPS: [&str; 2] = ["int", "sum"];
const OPS: [&str; 16] = ["-", "+", "=", "*", "xx", "<", ">", "<=", ">=", "!=", "+-", "->", "~~", "-:", ",", "."];
fn is_op_ch(ch: &str) -> bool { OPS.contains(&ch) }

fn join_tokens(parts: &[String]) -> String {
    let mut s = String::new();
    let mut prev = String::new();
    for p in parts {
        if p.is_empty() { continue; }
        let starts_alnum = p.chars().next().map(|c| c.is_ascii_alphanumeric() || c == '(').unwrap_or(false);
        let starts_alpha = p.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false);
        let ends_alpha = s.chars().last().map(|c| c.is_ascii_alphabetic()).unwrap_or(false);
        let last_word: String = s.chars().rev().take_while(|c| c.is_ascii_alphabetic()).collect();
        let need = !s.is_empty() && (
            ((prev.contains('_') || prev.contains('^')) && starts_alnum)
            || (ends_alpha && starts_alpha && (p.len() > 1 || last_word.len() >= 2))
            || OPS.contains(&p.as_str())
            || ["xx", "int", "sum", "oo", "pi", "sqrt"].iter().any(|k| p.starts_with(k))
            || (["xx", "int", "sum", "oo", "pi", ")", "-", "+", "="].iter().any(|k| s.ends_with(k)) && starts_alnum));
        if need { s.push(' '); }
        s.push_str(p);
        prev = p.clone();
    }
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

struct Emitter<'a, 'b> { l: &'b mut Layout<'a>, row_h: f32 }

impl<'a, 'b> Emitter<'a, 'b> {
    fn ch(&self, n: &Node) -> Option<String> { if let Node::Sym(i) = n { Some(self.l.syms[*i].ch.clone()) } else { None } }
    fn is_op(&self, n: &Node) -> bool { self.ch(n).map(|c| is_op_ch(&c)).unwrap_or(false) }
    fn b(&self, n: &Node) -> Rect { self.l.node_b(n) }

    fn emit(&mut self, n: &Node) -> String {
        match n {
            Node::Frac(num, den, _) => format!("({})/({})", self.row(num, false), self.row(den, false)),
            Node::Sqrt(body, _) => format!("sqrt({})", self.row(body, false)),
            Node::Sym(i) => self.l.syms[*i].ch.clone(),
        }
    }

    fn row(&mut self, nodes: &[Node], flat: bool) -> String {
        if nodes.is_empty() { return String::new(); }
        let h = self.l.h;
        let plain: Vec<Rect> = nodes.iter().filter(|n| matches!(n, Node::Sym(_)) && !self.is_op(n)
            && !BIGOPS.contains(&self.ch(n).unwrap_or_default().as_str()) && !is_dot(&self.b(n), 999.0)).map(|n| self.b(n)).collect();
        let ref_h = if plain.len() >= 3 { median(plain.iter().map(|b| b.h()).collect()) } else { self.row_h.max(median(plain.iter().map(|b| b.h()).collect())) };
        let ref_cy = median(if plain.is_empty() { nodes.iter().map(|n| self.b(n).cy()).collect() } else { plain.iter().map(|b| b.cy()).collect() });
        let row_base = if plain.len() >= 2 { Some(median(plain.iter().map(|b| b.y1).collect())) } else { None };
        let _ = h;
        // limits of ∫ / ∑ written slightly left of the sign go right behind it
        let mut nodes: Vec<Node> = nodes.to_vec();
        let ops: Vec<usize> = nodes.iter().filter_map(|n| if let Node::Sym(i) = n { if BIGOPS.contains(&self.l.syms[*i].ch.as_str()) { Some(*i) } else { None } } else { None }).collect();
        for opi in ops {
            let bb = self.l.syms[opi].b;
            let is_lim = |m: &Node, me: &Self| { let mb = me.b(m); !matches!(m, Node::Sym(i) if *i == opi) && mb.x1 > bb.x0 - 0.9 * ref_h && mb.x0 < bb.x0
                && mb.h() < 0.8 * ref_h && (mb.y0 > bb.y1 - 0.45 * bb.h() || mb.y1 < bb.y0 + 0.45 * bb.h()) };
            let lims: Vec<Node> = nodes.iter().filter(|m| is_lim(m, self)).cloned().collect();
            if lims.is_empty() { continue; }
            nodes.retain(|m| !is_lim(m, self));
            let pos = nodes.iter().position(|n| matches!(n, Node::Sym(i) if *i == opi)).unwrap_or(0);
            let mut lims = lims;
            lims.sort_by(|a, c| self.b(a).x0.partial_cmp(&self.b(c).x0).unwrap());
            for (k, m) in lims.into_iter().enumerate() { nodes.insert(pos + 1 + k, m); }
        }
        let mut out: Vec<String> = vec![];
        let mut base: Option<Node> = None;
        let mut i = 0;
        while i < nodes.len() {
            let n = nodes[i].clone();
            let nb = self.b(&n);
            if let Some(ch) = self.ch(&n).filter(|c| BIGOPS.contains(&c.as_str())) {
                let bb = nb;
                let (mut up, mut dn) = (vec![], vec![]);
                let mut j = i + 1;
                while j < nodes.len() {
                    let mb = self.b(&nodes[j]);
                    let near = mb.x0 < bb.x0 || if ch == "sum" { mb.cx() < bb.x1 + 0.2 * ref_h } else { mb.x0 < bb.x1 + 0.9 * ref_h };
                    if !near { break; }
                    if mb.h() < 0.8 * ref_h && mb.y1 < bb.y0 + 0.45 * bb.h() { up.push(nodes[j].clone()); j += 1; continue; }
                    if mb.h() < 0.8 * ref_h && mb.y0 > bb.y1 - 0.45 * bb.h() { dn.push(nodes[j].clone()); j += 1; continue; }
                    break;
                }
                let mut t = ch.clone();
                if !dn.is_empty() { t += &format!("_({})", self.row(&dn, false)); }
                if !up.is_empty() { t += &format!("^({})", self.row(&up, false)); }
                out.push(t);
                base = None;
                i = j;
                continue;
            }
            if let (Some(bn), false, false, true) = (base.clone(), flat, self.is_op(&n), matches!(n, Node::Sym(_))) {
                let mut bb = self.b(&bn);
                if bb.h() <= 0.4 * ref_h { bb = Rect { x0: bb.x0, x1: bb.x1, y0: ref_cy - ref_h / 2.0, y1: ref_cy + ref_h / 2.0 }; }
                let bch = self.ch(&bn).unwrap_or_default();
                let dips = matches!(bch.as_str(), "g" | "j" | "p" | "q" | "y" | "Y") || row_base.map(|rb| bb.y1 > rb + 0.3 * ref_h && bb.y0 > rb - 1.1 * ref_h).unwrap_or(false);
                if matches!(bn, Node::Sym(_)) && dips {
                    let y1 = bb.y1.min(match row_base { Some(rb) => rb.max(bb.y0 + 0.45 * bb.h()), None => bb.y0 + 0.62 * bb.h() });
                    bb.y1 = bb.y0 + (y1 - bb.y0).max(4.0);
                }
                let (bcy, bh) = (bb.cy(), bb.h());
                let not_big = nb.h() < 1.3 * bh.max(ref_h * 0.8);
                let is_sup = not_big && nb.cy() < bcy - 0.3 * bh && nb.y1 < bcy + 0.15 * bh;
                let is_sub = not_big && nb.cy() > bcy + 0.3 * bh && nb.y0 > bcy - 0.12 * bh && nb.y1 > bb.y1 + 0.12 * bh
                    // y, g, p, q, j hang below the line by themselves: only a subscript if they also start low
                    && !(self.ch(&n).map(|c| ["g", "j", "p", "q", "y"].contains(&c.as_str())).unwrap_or(false) && nb.y0 < bcy + 0.15 * bh);
                if is_sup || is_sub {
                    let mut grp = vec![n.clone()];
                    let mut j = i + 1;
                    while j < nodes.len() {
                        let mb = self.b(&nodes[j]);
                        let same = if is_sup { mb.cy() < bcy - 0.2 * bh && mb.y1 < bcy + 0.15 * bh } else { mb.cy() > bcy + 0.2 * bh && mb.y0 > bcy - 0.15 * bh };
                        let lastb = self.b(grp.last().unwrap());
                        if !same || mb.x0 > lastb.x1 + 0.9 * ref_h { break; }
                        grp.push(nodes[j].clone());
                        j += 1;
                    }
                    if is_sup && grp.len() == 1 {
                        if let Node::Sym(si) = grp[0] {
                            let m = match self.l.syms[si].ch.as_str() { "z" | "Z" => Some("2"), "o" | "O" => Some("0"), "l" | "I" | "|" => Some("1"), "s" | "S" => Some("5"), "g" | "q" => Some("9"), "b" => Some("6"), _ => None };
                            if let Some(m) = m { self.l.syms[si].ch = m.into(); }
                        }
                    }
                    let inner = self.row(&grp, is_sub);
                    let piece = if inner.chars().count() == 1 { inner } else { format!("({})", inner) };
                    if let Some(last) = out.last_mut() { last.push_str(if is_sup { "^" } else { "_" }); last.push_str(&piece); }
                    i = j;
                    continue;
                }
            }
            let e = self.emit(&n);
            out.push(e);
            base = if self.is_op(&n) { None } else { Some(n) };
            i += 1;
        }
        join_tokens(&out)
    }
}

fn fix_digits(l: &mut Layout, nodes: &[Node]) {
    let syms: Vec<usize> = nodes.iter().filter_map(|n| if let Node::Sym(i) = n { Some(*i) } else { None }).collect();
    for k in 0..syms.len() {
        let digit_nb = [k.checked_sub(1), Some(k + 1)].iter().flatten().filter_map(|&j| syms.get(j)).any(|&j| { let c = &l.syms[j].ch; c.len() == 1 && c.chars().all(|c| c.is_ascii_digit()) });
        if !digit_nb { continue; }
        let s = &mut l.syms[syms[k]];
        s.ch = match s.ch.as_str() { "o" | "O" => "0", "l" | "I" | "|" => "1", "s" | "S" => "5", "z" | "Z" => "2", o => o }.to_string();
    }
    for n in nodes {
        match n { Node::Frac(a, b, _) => { fix_digits(l, a); fix_digits(l, b); } Node::Sqrt(a, _) => fix_digits(l, a), _ => {} }
    }
}

/// A lone "x" with space on both sides and a number after it is a times sign (… × 10^16).
fn times_signs(l: &mut Layout, nodes: &[Node], h: f32) {
    let row: Vec<(Rect, Option<usize>)> = nodes.iter().map(|n| (l.node_b(n), if let Node::Sym(i) = n { Some(*i) } else { None })).collect();
    for k in 1..row.len().saturating_sub(1) {
        let Some(si) = row[k].1 else { continue };
        if !["x", "X"].contains(&l.syms[si].ch.as_str()) { continue; }
        let next_num = row[k + 1].1.map(|j| l.syms[j].ch.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)).unwrap_or(false);
        let b = row[k].0;
        if next_num && b.x0 - row[k - 1].0.x1 > 0.35 * h && row[k + 1].0.x0 - b.x1 > 0.35 * h { l.syms[si].ch = "xx".into(); }
    }
    for n in nodes { match n { Node::Frac(a, b, _) => { times_signs(l, a, h); times_signs(l, b, h); } Node::Sqrt(a, _) => times_signs(l, a, h), _ => {} } }
}

fn rows_of(nodes: &[Node], acc: &mut Vec<Vec<usize>>) {
    acc.push(nodes.iter().filter_map(|n| if let Node::Sym(i) = n { Some(*i) } else { None }).collect());
    for n in nodes {
        match n { Node::Frac(a, b, _) => { rows_of(a, acc); rows_of(b, acc); } Node::Sqrt(a, _) => rows_of(a, acc), _ => {} }
    }
}

/* ---------------- text vs. formula ---------------- */

fn looks_structured(strokes: &[Stroke]) -> bool {
    let h = char_height(strokes);
    let ids: Vec<usize> = (0..strokes.len()).collect();
    let mut l = Layout { strokes, bs: strokes.iter().map(|s| s.bounds()).collect(), h, syms: vec![] };
    let tree = l.structure(&ids);
    if tree.iter().any(|n| !matches!(n, Node::Sym(_))) { return true; }
    let syms: Vec<Rect> = tree.iter().map(|n| l.node_b(n)).filter(|b| !is_flat(b, h) && !is_dot(b, h)).collect();
    syms.windows(2).any(|w| w[1].h() < 0.75 * w[0].h() && (w[1].cy() - w[0].cy()).abs() > 0.38 * w[0].h() && w[1].x0 - w[0].x1 < 0.6 * h)
}

pub fn looks_like_math_text(t: &str) -> bool {
    let s = t.trim();
    if s.chars().any(|c| "=^√∫∑π≤≥≠±×÷".contains(c)) { return true; }
    let words = s.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| w.len() >= 3 && !["sin", "cos", "tan", "log", "exp", "lim", "max", "min"].contains(&w.to_lowercase().as_str())).count();
    words == 0 && s.chars().any(|c| c.is_ascii_digit()) && s.chars().any(|c| "+-*/".contains(c))
}

/* ---------------- the job ---------------- */

#[derive(Serialize, Clone, Debug)]
pub struct Request {
    pub w: f32, pub h: f32, pub pre: String, pub strokes: Vec<Vec<[f32; 3]>>,
    /// where the request's (0,0) is on the page (not sent to the recogniser)
    #[serde(skip)] pub origin: (f32, f32),
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Converted {
    #[serde(rename = "type")]
    pub kind: String,
    pub src: String,
    pub alts: Vec<String>,
    /// indices (into the job's strokes) this piece came from, for re-reading as text/math
    pub strokes: Vec<usize>,
    /// formulas: each symbol as read — its strokes (job indices), token and box — for training
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub syms: Vec<SymOut>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SymOut { pub strokes: Vec<usize>, pub ch: String, pub b: [f32; 4] }

struct MathLine { line: usize, h: f32, syms: Vec<Sym>, tree: Vec<Node>, rows: Vec<Vec<usize>>, leftovers: Vec<usize> }

enum Stage { TextLines, MathRows, MathSyms, Done }

pub struct Job {
    strokes: Vec<Stroke>,
    mode: String,
    lines: Vec<Vec<usize>>,
    texts: Vec<Vec<String>>,
    math: Vec<MathLine>,
    stage: Stage,
    pending: Option<Vec<Request>>,
    result: Vec<Converted>,
}

fn request_for(strokes: &[&Stroke]) -> Request {
    let mut r = Rect::empty();
    for s in strokes { r.union(&s.bounds()); }
    Request {
        w: r.w().max(1.0), h: r.h().max(1.0), pre: String::new(), origin: (r.x0, r.y0),
        strokes: strokes.iter().map(|s| s.p.iter().map(|q| [((q.x - r.x0) * 10.0).round() / 10.0, ((q.y - r.y0) * 10.0).round() / 10.0, q.t]).collect()).collect(),
    }
}

impl Job {
    pub fn new(strokes: Vec<Stroke>, mode: &str) -> Job {
        let strokes: Vec<Stroke> = strokes.into_iter().filter(|s| s.k != "hl" && !s.p.is_empty()).collect();
        let lines = split_lines(&strokes);
        let mut j = Job { strokes, mode: mode.into(), lines, texts: vec![], math: vec![], stage: Stage::TextLines, pending: None, result: vec![] };
        if j.strokes.is_empty() { j.stage = Stage::Done; }
        else if j.mode == "math" { let all: Vec<usize> = (0..j.lines.len()).collect(); j.start_math(&all); }
        else { j.pending = Some(j.lines.iter().map(|l| request_for(&l.iter().map(|&i| &j.strokes[i]).collect::<Vec<_>>())).collect()); }
        j
    }

    /// What ML Kit should read next (each request is one ink), or None when finished.
    pub fn requests(&self) -> Option<&Vec<Request>> { self.pending.as_ref() }

    fn start_math(&mut self, lines: &[usize]) {
        self.math.clear();
        for &li in lines {
            let ss: Vec<Stroke> = self.lines[li].iter().map(|&i| self.strokes[i].clone()).collect();
            let h = char_height(&ss);
            let ids: Vec<usize> = (0..ss.len()).collect();
            let mut l = Layout { strokes: &ss, bs: ss.iter().map(|s| s.bounds()).collect(), h, syms: vec![] };
            let tree = l.structure(&ids);
            let mut rows = vec![];
            rows_of(&tree, &mut rows);
            rows.retain(|r| !r.is_empty());
            self.math.push(MathLine { line: li, h, syms: l.syms, tree, rows, leftovers: vec![] });
        }
        let mut reqs = vec![];
        for m in &self.math {
            let ls: Vec<&Stroke> = self.lines[m.line].iter().map(|&i| &self.strokes[i]).collect();
            for r in &m.rows {
                reqs.push(request_for(&r.iter().flat_map(|&si| m.syms[si].strokes.iter().map(|&k| ls[k])).collect::<Vec<_>>()));
            }
        }
        self.stage = Stage::MathRows;
        if reqs.is_empty() { self.finish_math(); } else { self.pending = Some(reqs); }
    }

    /// Answers for the last requests: per request, the recogniser's candidate strings (best first).
    pub fn feed(&mut self, answers: Vec<Vec<String>>) {
        self.pending = None;
        match self.stage {
            Stage::TextLines => {
                self.texts = answers;
                self.texts.resize(self.lines.len(), vec![]);
                if self.mode == "auto" {
                    let mathy: Vec<usize> = (0..self.lines.len()).filter(|&li| {
                        let ss: Vec<Stroke> = self.lines[li].iter().map(|&i| self.strokes[i].clone()).collect();
                        looks_structured(&ss) || looks_like_math_text(self.texts[li].first().map(|s| s.as_str()).unwrap_or(""))
                    }).collect();
                    if !mathy.is_empty() { self.start_math(&mathy); return; }
                }
                self.assemble();
            }
            Stage::MathRows => {
                let mut k = 0;
                for mi in 0..self.math.len() {
                    let m = &mut self.math[mi];
                    let ss: Vec<Stroke> = self.lines[m.line].iter().map(|&i| self.strokes[i].clone()).collect();
                    let l = Layout { strokes: &ss, bs: ss.iter().map(|s| s.bounds()).collect(), h: m.h, syms: std::mem::take(&mut m.syms) };
                    let mut l = l;
                    for r in m.rows.clone() {
                        let cands: Vec<String> = answers.get(k).cloned().unwrap_or_default();
                        k += 1;
                        let chars = |t: &str| t.chars().filter(|c| !c.is_whitespace()).map(|c| c.to_string()).collect::<Vec<_>>();
                        let mut done = false;
                        for t in &cands {
                            let ch = chars(t);
                            if ch.len() == r.len() {
                                for (n, &si) in r.iter().enumerate() { let p = map_char(&ch[n]).map(String::from).unwrap_or_else(|| ch[n].clone()); let v = refine(&l, &p, &l.syms[si]); l.syms[si].ch = v; }
                                done = true;
                                break;
                            }
                        }
                        if !done {
                            let solid: Vec<usize> = r.iter().copied().filter(|&si| !is_dot(&l.syms[si].b, m.h)).collect();
                            if solid.len() < r.len() {
                                for t in &cands {
                                    let ch = chars(t);
                                    if ch.len() == solid.len() {
                                        for (n, &si) in solid.iter().enumerate() { let p = map_char(&ch[n]).map(String::from).unwrap_or_else(|| ch[n].clone()); let v = refine(&l, &p, &l.syms[si]); l.syms[si].ch = v; }
                                        m.leftovers.extend(r.iter().copied().filter(|si| !solid.contains(si)));
                                        done = true;
                                        break;
                                    }
                                }
                            }
                        }
                        if !done { m.leftovers.extend(r.iter().copied()); }
                    }
                    m.syms = l.syms;
                }
                let mut reqs = vec![];
                for m in &self.math {
                    let ls: Vec<&Stroke> = self.lines[m.line].iter().map(|&i| &self.strokes[i]).collect();
                    for &si in &m.leftovers { reqs.push(request_for(&m.syms[si].strokes.iter().map(|&k| ls[k]).collect::<Vec<_>>())); }
                }
                if reqs.is_empty() { self.finish_math(); } else { self.stage = Stage::MathSyms; self.pending = Some(reqs); }
            }
            Stage::MathSyms => {
                let mut k = 0;
                for m in self.math.iter_mut() {
                    let ss: Vec<Stroke> = self.lines[m.line].iter().map(|&i| self.strokes[i].clone()).collect();
                    let mut l = Layout { strokes: &ss, bs: ss.iter().map(|s| s.bounds()).collect(), h: m.h, syms: std::mem::take(&mut m.syms) };
                    for &si in &m.leftovers.clone() {
                        let cands = answers.get(k).cloned().unwrap_or_default();
                        k += 1;
                        let v = choose(&l, &cands, &l.syms[si]);
                        l.syms[si].ch = v;
                    }
                    m.syms = l.syms;
                }
                self.finish_math();
            }
            Stage::Done => {}
        }
    }

    fn finish_math(&mut self) {
        let mut srcs: Vec<(usize, String)> = vec![];
        let mut symsets: std::collections::HashMap<usize, Vec<SymOut>> = Default::default();
        for m in self.math.iter_mut() {
            let ss: Vec<Stroke> = self.lines[m.line].iter().map(|&i| self.strokes[i].clone()).collect();
            let mut l = Layout { strokes: &ss, bs: ss.iter().map(|s| s.bounds()).collect(), h: m.h, syms: std::mem::take(&mut m.syms) };
            // personal handwriting samples correct what the text recogniser can't read
            for si in 0..l.syms.len() {
                let s = l.syms[si].clone();
                if s.strokes.len() == 1 && (is_flat(&s.b, m.h) || is_dot(&s.b, m.h)) { continue; }
                if is_plus(&l, &s) || is_infinity(&l, &s) { continue; }
                let group: Vec<&Stroke> = s.strokes.iter().map(|&k| &ss[k]).collect();
                if let Some(tok) = dollarp::override_for(&group, &s.ch) { l.syms[si].ch = tok; }
            }
            fix_digits(&mut l, &m.tree);
            times_signs(&mut l, &m.tree, m.h);
            let tree = m.tree.clone();
            let mut e = Emitter { l: &mut l, row_h: m.h };
            let mut ascii = e.row(&tree, false);
            for (a, b) in [("s i n", "sin"), ("c o s", "cos"), ("l n", "ln"), ("t a n", "tan"), ("l o g", "log")] { ascii = ascii.replace(a, b); }
            srcs.push((m.line, ascii));
            let mut so: Vec<SymOut> = l.syms.iter().map(|sy| SymOut { strokes: sy.strokes.iter().map(|&k| self.lines[m.line][k]).collect(), ch: sy.ch.clone(), b: [sy.b.x0, sy.b.y0, sy.b.x1, sy.b.y1] }).collect();
            so.sort_by(|a, b| a.b[0].partial_cmp(&b.b[0]).unwrap());
            symsets.insert(m.line, so);
            m.syms = l.syms;
        }
        if self.mode == "math" {
            self.result = srcs.into_iter().map(|(li, s)| Converted { kind: "math".into(), src: s, alts: vec![], strokes: self.lines[li].clone(), syms: symsets.remove(&li).unwrap_or_default() }).collect();
            self.stage = Stage::Done;
            return;
        }
        let map: std::collections::HashMap<usize, String> = srcs.into_iter().collect();
        self.assemble_with(&map);
    }

    fn assemble(&mut self) { self.assemble_with(&Default::default()); }

    fn assemble_with(&mut self, math: &std::collections::HashMap<usize, String>) {
        let mut out: Vec<Converted> = vec![];
        for li in 0..self.lines.len() {
            if let Some(src) = math.get(&li) {
                out.push(Converted { kind: "math".into(), src: src.clone(), alts: self.texts.get(li).and_then(|t| t.first()).cloned().into_iter().collect(), strokes: self.lines[li].clone(), syms: vec![] });
                continue;
            }
            let alts = self.texts.get(li).cloned().unwrap_or_default();
            let t = alts.first().cloned().unwrap_or_default();
            match out.last_mut() {
                Some(last) if last.kind == "text" => { last.src.push('\n'); last.src.push_str(&t); last.alts.clear(); last.strokes.extend(&self.lines[li]); }
                _ => out.push(Converted { kind: "text".into(), src: t, alts: alts.into_iter().take(4).collect(), strokes: self.lines[li].clone(), syms: vec![] }),
            }
        }
        self.result = out;
        self.stage = Stage::Done;
    }

    pub fn done(&self) -> bool { matches!(self.stage, Stage::Done) && self.pending.is_none() }
    pub fn result(&self) -> &Vec<Converted> { &self.result }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Pt;

    /// strokes from polylines, densified, tagged with a label used by the fake recogniser
    fn s(pts: &[(f32, f32)]) -> Stroke {
        let mut p = vec![];
        for w in pts.windows(2) { for k in 0..8 { let t = k as f32 / 8.0; p.push(Pt::new(w[0].0 + (w[1].0 - w[0].0) * t, w[0].1 + (w[1].1 - w[0].1) * t)); } }
        p.push(Pt::new(pts.last().unwrap().0, pts.last().unwrap().1));
        Stroke { c: "#000".into(), s: 2.0, k: String::new(), d: String::new(), g: 0, cut: 0, p, rt: None }
    }
    struct Glyph { label: &'static str, strokes: Vec<Stroke> }
    fn plus(x: f32, y: f32, sz: f32, read: &'static str) -> Glyph { Glyph { label: read, strokes: vec![s(&[(x, y + sz / 2.0), (x + sz, y + sz / 2.0)]), s(&[(x + sz / 2.0, y), (x + sz / 2.0, y + sz)])] } }
    fn inf(x: f32, y: f32, w: f32, h: f32, read: &'static str) -> Glyph {
        Glyph { label: read, strokes: vec![s(&[(x, y + h / 2.0), (x + w * 0.25, y), (x + w * 0.5, y + h / 2.0), (x + w * 0.75, y + h), (x + w, y + h / 2.0), (x + w * 0.75, y), (x + w * 0.5, y + h / 2.0), (x + w * 0.25, y + h), (x, y + h / 2.0)])] }
    }
    fn g(label: &'static str, strokes: Vec<Stroke>) -> Glyph { Glyph { label, strokes } }

    /// Fake recogniser: reads the labels of the glyphs whose strokes appear in a request, left to right.
    fn run(glyphs: Vec<Glyph>, mode: &str) -> Vec<Converted> {
        let mut strokes = vec![];
        let mut labels = vec![];
        for (gi, gl) in glyphs.iter().enumerate() { for st in &gl.strokes { strokes.push(st.clone()); labels.push((gi, gl.label)); } }
        let all = strokes.clone();
        let mut job = Job::new(strokes, mode);
        while let Some(reqs) = job.requests().cloned() {
            let answers = reqs.iter().map(|r| {
                // match request strokes back to originals by shape (first point offset is consistent per request)
                let mut found: Vec<(f32, usize, &str)> = vec![];
                for rs in &r.strokes {
                    for (k, st) in all.iter().enumerate() {
                        if st.p.len() == rs.len() {
                            let (dx, dy) = r.origin;
                            if st.p.iter().zip(rs).all(|(a, b)| (a.x - b[0] - dx).abs() < 0.2 && (a.y - b[1] - dy).abs() < 0.2) {
                                let x0 = st.p.iter().map(|q| q.x).fold(f32::MAX, f32::min);
                                if !found.iter().any(|f| f.1 == labels[k].0) { found.push((x0, labels[k].0, labels[k].1)); }
                                break;
                            }
                        }
                    }
                }
                found.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                vec![found.iter().map(|f| f.2).collect::<Vec<_>>().join("")]
            }).collect();
            job.feed(answers);
        }
        job.result().clone()
    }

    #[test]
    fn fraction_and_subscripts() {
        // n_{p0} - J_s + (2π)/(k_b T)
        let v = vec![
            g("n", vec![s(&[(0.0, 60.0), (2.0, 90.0)]), s(&[(2.0, 66.0), (12.0, 60.0), (20.0, 66.0), (20.0, 90.0)])]),
            g("p", vec![s(&[(24.0, 84.0), (24.0, 112.0)]), s(&[(24.0, 86.0), (34.0, 84.0), (34.0, 96.0), (24.0, 98.0)])]),
            g("0", vec![s(&[(38.0, 104.0), (42.0, 104.0), (42.0, 110.0), (38.0, 110.0), (38.0, 104.0)])]),
            g("-", vec![s(&[(60.0, 74.0), (80.0, 73.0)])]),
            g("J", vec![s(&[(105.0, 48.0), (106.0, 80.0), (100.0, 92.0), (92.0, 86.0)])]),
            g("s", vec![s(&[(114.0, 88.0), (108.0, 92.0), (114.0, 96.0), (108.0, 104.0)])]),
            plus(132.0, 66.0, 18.0, "+"),
            g("2", vec![s(&[(168.0, 30.0), (180.0, 28.0), (176.0, 44.0), (166.0, 58.0), (182.0, 58.0)])]),
            g("π", vec![s(&[(186.0, 34.0), (214.0, 32.0)]), s(&[(194.0, 34.0), (192.0, 58.0)]), s(&[(206.0, 34.0), (208.0, 58.0)])]),
            g("-", vec![s(&[(162.0, 72.0), (222.0, 71.0)])]),
            g("k", vec![s(&[(168.0, 84.0), (168.0, 112.0)]), s(&[(180.0, 88.0), (168.0, 100.0), (180.0, 112.0)])]),
            g("b", vec![s(&[(184.0, 108.0), (184.0, 124.0)]), s(&[(184.0, 118.0), (192.0, 116.0), (192.0, 124.0), (184.0, 124.0)])]),
            g("T", vec![s(&[(196.0, 84.0), (222.0, 82.0)]), s(&[(209.0, 84.0), (208.0, 112.0)])]),
        ];
        let r = run(v, "math");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].src, "n_(p0) - J_s + (2 pi)/(k_b T)");
    }

    #[test]
    fn integral_with_misreads() {
        // 5x + 2y^2 + ∫_{-∞}^{∞} J_s^2 dz, with + read as t, ∞ as a, 2 as z
        let v = vec![
            g("5", vec![s(&[(10.0, 60.0), (0.0, 60.0), (0.0, 72.0), (10.0, 74.0), (10.0, 88.0), (0.0, 90.0)])]),
            g("x", vec![s(&[(16.0, 70.0), (34.0, 90.0)]), s(&[(34.0, 70.0), (16.0, 90.0)])]),
            plus(46.0, 70.0, 18.0, "t"),
            g("2", vec![s(&[(76.0, 62.0), (90.0, 60.0), (86.0, 76.0), (74.0, 90.0), (92.0, 90.0)])]),
            g("y", vec![s(&[(98.0, 70.0), (106.0, 90.0)]), s(&[(114.0, 70.0), (100.0, 112.0)])]),
            g("z", vec![s(&[(118.0, 48.0), (128.0, 46.0), (126.0, 56.0), (116.0, 64.0), (130.0, 64.0)])]),
            plus(140.0, 70.0, 18.0, "t"),
            g("S", vec![s(&[(200.0, 20.0), (190.0, 22.0), (184.0, 60.0), (178.0, 120.0), (168.0, 122.0)])]),
            inf(206.0, 8.0, 26.0, 12.0, "a"),
            g("-", vec![s(&[(150.0, 132.0), (162.0, 132.0)])]),
            inf(166.0, 126.0, 26.0, 12.0, "a"),
            g("J", vec![s(&[(228.0, 62.0), (229.0, 90.0), (222.0, 100.0), (214.0, 94.0)])]),
            g("s", vec![s(&[(238.0, 96.0), (232.0, 99.0), (238.0, 103.0), (232.0, 108.0)])]),
            g("z", vec![s(&[(244.0, 44.0), (254.0, 42.0), (252.0, 52.0), (242.0, 60.0), (256.0, 60.0)])]),
            g("d", vec![s(&[(280.0, 76.0), (270.0, 80.0), (270.0, 90.0), (280.0, 90.0)]), s(&[(280.0, 52.0), (280.0, 92.0)])]),
            g("z", vec![s(&[(292.0, 72.0), (308.0, 72.0), (292.0, 90.0), (308.0, 90.0)])]),
        ];
        let r = run(v, "math");
        assert_eq!(r[0].src, "5x + 2y^2 + int_(- oo)^(oo) J_s^2 dz");
    }

    #[test]
    fn handwritten_x_is_not_infinity_and_stays_on_the_line() {
        // 2x + 3x^2 + 4yzx: small two-stroke x's (wider than tall) sitting on the baseline next to tall digits
        let x = |x0: f32| g("x", vec![s(&[(x0, 76.0), (x0 + 16.0, 90.0)]), s(&[(x0 + 16.0, 76.0), (x0, 90.0)])]);
        let two = |x0: f32, y0: f32, sz: f32, l: &'static str| g(l, vec![s(&[(x0, y0 + 2.0), (x0 + sz * 0.6, y0), (x0 + sz * 0.5, y0 + sz * 0.5), (x0, y0 + sz), (x0 + sz * 0.7, y0 + sz)])]);
        let v = vec![
            two(0.0, 60.0, 30.0, "2"), x(26.0),
            plus(52.0, 70.0, 16.0, "+"),
            g("3", vec![s(&[(80.0, 60.0), (96.0, 62.0), (86.0, 74.0), (98.0, 80.0), (80.0, 90.0)])]), x(104.0), two(124.0, 58.0, 12.0, "2"),
            plus(146.0, 70.0, 16.0, "+"),
            g("4", vec![s(&[(180.0, 60.0), (172.0, 80.0), (190.0, 80.0)]), s(&[(186.0, 64.0), (186.0, 90.0)])]),
            g("y", vec![s(&[(196.0, 76.0), (204.0, 90.0)]), s(&[(212.0, 76.0), (200.0, 104.0)])]),
            g("z", vec![s(&[(218.0, 76.0), (232.0, 76.0), (218.0, 90.0), (232.0, 90.0)])]), x(238.0),
            x(272.0), // × written like an x, with space around it
            g("1", vec![s(&[(306.0, 60.0), (306.0, 90.0)])]),
            g("0", vec![s(&[(316.0, 60.0), (330.0, 60.0), (330.0, 90.0), (316.0, 90.0), (316.0, 60.0)])]),
            g("1", vec![s(&[(338.0, 46.0), (338.0, 60.0)])]),
            g("6", vec![s(&[(352.0, 44.0), (344.0, 54.0), (348.0, 60.0), (354.0, 56.0), (346.0, 52.0)])]),
        ];
        let r = run(v, "math");
        assert_eq!(r.iter().map(|c| c.src.clone()).collect::<Vec<_>>().join(" | ").replace(" ", ""), "2x+3x^2+4yzxxx10^(16)");
    }

    #[test]
    fn auto_mode_mixes_text_and_math() {
        let word = |label: &'static str, x: f32, y: f32| g(label, (0..3).map(|k| s(&[(x + k as f32 * 20.0, y), (x + k as f32 * 20.0 + 10.0, y + 24.0), (x + k as f32 * 20.0 + 20.0, y)])).collect());
        let v = vec![
            word("hello world", 0.0, 10.0),
            word("second line", 0.0, 60.0),
            g("x", vec![s(&[(0.0, 120.0), (20.0, 142.0)]), s(&[(20.0, 120.0), (0.0, 142.0)])]),
            g("2", vec![s(&[(22.0, 106.0), (32.0, 104.0), (30.0, 112.0), (22.0, 120.0), (34.0, 120.0)])]),
            g("=", vec![s(&[(40.0, 128.0), (58.0, 128.0)]), s(&[(40.0, 136.0), (58.0, 136.0)])]),
            g("4", vec![s(&[(70.0, 120.0), (64.0, 134.0), (80.0, 134.0)]), s(&[(76.0, 122.0), (76.0, 142.0)])]),
        ];
        let r = run(v, "auto");
        assert_eq!(r.iter().map(|c| (c.kind.as_str(), c.src.as_str())).collect::<Vec<_>>(),
            vec![("text", "hello world\nsecond line"), ("math", "x^2 = 4")]);
    }
}
