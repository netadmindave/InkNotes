//! Ink operations: render geometry, smoothing, shape snapping, partial eraser, lasso.

use crate::freehand::{get_stroke, Options};
use crate::model::{Pt, Rect, Stroke};

/* ---------------- rendering ---------------- */

/// Visible line width of a stroke (page px).
pub fn width_of(st: &Stroke) -> f32 {
    match st.k.as_str() {
        "hl" => st.s * 4.5,
        "pc" => st.s * 0.8,
        _ => st.s,
    }
}

/// How a stroke should be painted.
pub enum Geometry {
    /// filled outline polygon (freehand pen / pencil / highlighter)
    Fill(Vec<[f32; 2]>),
    /// stroked centre-line (dashed / dotted lines and snapped shapes)
    Line { pts: Vec<[f32; 2]>, closed: bool, smooth: bool },
}

pub fn geometry(st: &Stroke) -> Geometry {
    if !st.d.is_empty() || st.g != 0 {
        return Geometry::Line { pts: st.p.iter().map(|q| [q.x, q.y]).collect(), closed: st.g == 2, smooth: st.g == 0 };
    }
    let has_pressure = st.p.iter().any(|q| (q.p - 0.5).abs() > 1e-4);
    let mut o = Options { last: true, ..Default::default() };
    match st.k.as_str() {
        "hl" => { o.size = st.s * 3.2; o.thinning = 0.0; o.smoothing = 0.7; o.streamline = 0.6; o.simulate_pressure = false; }
        "pc" => { o.size = st.s * 0.75; o.thinning = 0.3; o.smoothing = 0.5; o.streamline = 0.4; o.simulate_pressure = !has_pressure; }
        _ => {
            o.size = st.s; o.thinning = 0.5; o.smoothing = 0.6; o.streamline = 0.45; o.simulate_pressure = !has_pressure;
            if !has_pressure { o.taper_start = 6.0; o.taper_end = 10.0; }
        }
    }
    let pts: Vec<[f32; 3]> = st.p.iter().map(|q| [q.x, q.y, q.p]).collect();
    Geometry::Fill(get_stroke(&pts, &o))
}

pub fn opacity(st: &Stroke) -> f32 {
    match st.k.as_str() { "hl" => 0.32, "pc" => 0.82, _ => 1.0 }
}

/* ---------------- smoothing ---------------- */

/// Moving-average smoothing (freehand strokes only). Returns true if changed.
pub fn smooth(st: &mut Stroke) -> bool {
    if st.p.len() < 5 || st.g != 0 {
        return false;
    }
    let src = &st.p;
    let mut out = vec![src[0]];
    for i in 1..src.len() - 1 {
        let (mut sx, mut sy, mut sp, mut k) = (0.0, 0.0, 0.0, 0.0);
        for j in i.saturating_sub(2)..=(i + 2).min(src.len() - 1) {
            sx += src[j].x; sy += src[j].y; sp += src[j].p; k += 1.0;
        }
        let q = Pt { x: sx / k, y: sy / k, p: sp / k, t: src[i].t };
        let l = out.last().unwrap();
        if (q.x - l.x).hypot(q.y - l.y) > 0.8 {
            out.push(q);
        }
    }
    out.push(*src.last().unwrap());
    st.p = out;
    true
}

/* ---------------- shape snapping ---------------- */

type P = [f32; 2];
fn dist(a: P, b: P) -> f32 { (a[0] - b[0]).hypot(a[1] - b[1]) }
fn seg_dist(p: P, a: P, b: P) -> f32 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = (dx * dx + dy * dy).max(1e-6);
    let t = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0);
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}
fn path_len(p: &[P]) -> f32 { p.windows(2).map(|w| dist(w[0], w[1])).sum() }

fn resample(p: &[P], n: usize) -> Vec<P> {
    let step = (path_len(p) / (n as f32 - 1.0)).max(1e-3);
    let mut out = vec![p[0]];
    let mut acc = 0.0;
    for i in 1..p.len() {
        let mut a = p[i - 1];
        let mut d = dist(a, p[i]);
        while acc + d >= step && d > 0.0 {
            let t = (step - acc) / d;
            a = [a[0] + t * (p[i][0] - a[0]), a[1] + t * (p[i][1] - a[1])];
            out.push(a);
            d = dist(a, p[i]);
            acc = 0.0;
        }
        acc += d;
    }
    while out.len() < n { out.push(*p.last().unwrap()); }
    out.truncate(n);
    out
}

fn rdp(p: &[P], eps: f32) -> Vec<P> {
    if p.len() < 3 { return p.to_vec(); }
    let (mut idx, mut max) = (0, 0.0);
    for i in 1..p.len() - 1 {
        let d = seg_dist(p[i], p[0], p[p.len() - 1]);
        if d > max { max = d; idx = i; }
    }
    if max <= eps { return vec![p[0], p[p.len() - 1]]; }
    let mut l = rdp(&p[..=idx], eps);
    let r = rdp(&p[idx..], eps);
    l.pop();
    l.extend(r);
    l
}

fn snap_angle(a: P, b: P) -> P {
    let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
    let l = dist(a, b);
    let step = std::f32::consts::FRAC_PI_4;
    let k = (ang / step).round();
    if (ang - k * step).abs() < 6f32.to_radians() { [a[0] + l * (k * step).cos(), a[1] + l * (k * step).sin()] } else { b }
}

fn densify(v: &[P], closed: bool) -> Vec<Pt> {
    let mut out = vec![];
    let n = if closed { v.len() } else { v.len() - 1 };
    for i in 0..n {
        let (a, b) = (v[i], v[(i + 1) % v.len()]);
        let steps = (dist(a, b) / 3.0).ceil().max(1.0) as usize;
        for k in 0..steps {
            let t = k as f32 / steps as f32;
            out.push(Pt::new(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
        }
    }
    let e = if closed { v[0] } else { *v.last().unwrap() };
    out.push(Pt::new(e[0], e[1]));
    out
}

fn poly_residual(p: &[P], v: &[P]) -> f32 {
    let mut s = 0.0;
    for &q in p {
        let mut m = f32::MAX;
        for i in 0..v.len() { m = m.min(seg_dist(q, v[i], v[(i + 1) % v.len()])); }
        s += m;
    }
    s / p.len() as f32
}

fn merge_straight(mut v: Vec<P>) -> Vec<P> {
    let mut changed = true;
    while changed && v.len() > 3 {
        changed = false;
        for i in 0..v.len() {
            let n = v.len();
            let (a, b, c) = (v[(i + n - 1) % n], v[i], v[(i + 1) % n]);
            let v1 = [a[0] - b[0], a[1] - b[1]];
            let v2 = [c[0] - b[0], c[1] - b[1]];
            let cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (v1[0].hypot(v1[1]) * v2[0].hypot(v2[1])).max(1e-6);
            if cos < -0.93 || dist(a, b) < 0.08 * dist(a, c).max(1e-6) {
                v.remove(i);
                changed = true;
                break;
            }
        }
    }
    v
}

/// Snapped shape: new points and geometry flag (1 open, 2 closed).
pub struct Snapped {
    pub p: Vec<Pt>,
    pub g: u8,
}

/// Turn a hand-drawn stroke into a clean line / polygon / rectangle / ellipse.
/// `forced`: the pen was held still at the end (generous); otherwise only confident, larger shapes snap.
pub fn snap_shape(raw: &[Pt], forced: bool) -> Option<Snapped> {
    if raw.len() < 4 { return None; }
    let p0: Vec<P> = raw.iter().map(|q| [q.x, q.y]).collect();
    let bb = Rect::of_points(p0.iter().map(|q| (q[0], q[1])));
    let diag = bb.w().hypot(bb.h());
    if diag < if forced { 14.0 } else { 70.0 } { return None; }
    let l = path_len(&p0);
    let (a, b) = (p0[0], *p0.last().unwrap());
    let dev = p0.iter().map(|&q| seg_dist(q, a, b)).fold(0.0, f32::max);
    if dist(a, b) > 0.88 * l && dev < (if forced { 6.0 } else { 4.0f32 }).max((if forced { 0.08 } else { 0.045 }) * dist(a, b)) {
        return Some(Snapped { p: densify(&[a, snap_angle(a, b)], false), g: 1 });
    }
    let p = resample(&p0, 72);
    let closed = dist(a, b) < 14f32.max(0.2 * diag);
    if closed {
        let mut v = rdp(&p, 0.075 * diag);
        v.pop();
        let mut v = merge_straight(v);
        let poly_err = if v.len() >= 3 { poly_residual(&p, &v) / diag } else { 1.0 };
        let n = p.len() as f32;
        let cx = p.iter().map(|q| q[0]).sum::<f32>() / n;
        let cy = p.iter().map(|q| q[1]).sum::<f32>() / n;
        let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
        for q in &p { let (dx, dy) = (q[0] - cx, q[1] - cy); sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        sxx /= n; syy /= n; sxy /= n;
        let mut th = 0.5 * (2.0 * sxy).atan2(sxx - syy);
        let (sn, cs) = th.sin_cos();
        let (mut su, mut sv) = (0.0, 0.0);
        let uv = |q: &P| ((q[0] - cx) * cs + (q[1] - cy) * sn, -(q[0] - cx) * sn + (q[1] - cy) * cs);
        for q in &p { let (u, w) = uv(q); su += u * u; sv += w * w; }
        let mut ea = (2.0 * su / n).sqrt();
        let mut eb = (2.0 * sv / n).sqrt();
        let er = p.iter().map(|q| { let (u, w) = uv(q); (((u / ea.max(1e-3)).powi(2) + (w / eb.max(1e-3)).powi(2)).sqrt() - 1.0).abs() }).sum::<f32>() / n;
        let poly_ok = v.len() >= 3 && v.len() <= 6 && poly_err < if forced { 0.045 } else { 0.03 };
        let ell_ok = er < (if forced { 0.11 } else { 0.075 }) && v.len() >= 4;
        if poly_ok && (!ell_ok || (v.len() <= 4 && poly_err < er * 0.35)) {
            if v.len() == 4 {
                let right = (0..4).all(|i| {
                    let (q, p0, p2) = (v[i], v[(i + 3) % 4], v[(i + 1) % 4]);
                    let v1 = [p0[0] - q[0], p0[1] - q[1]];
                    let v2 = [p2[0] - q[0], p2[1] - q[1]];
                    ((v1[0] * v2[0] + v1[1] * v2[1]) / (v1[0].hypot(v1[1]) * v2[0].hypot(v2[1])).max(1e-6)).abs() < 0.22
                });
                if right {
                    let ang = (v[1][1] - v[0][1]).atan2(v[1][0] - v[0][0]);
                    if (2.0 * ang).sin().abs() < 8f32.to_radians().sin() {
                        let r = Rect::of_points(v.iter().map(|q| (q[0], q[1])));
                        let (ix, iy) = (r.w() * 0.03, r.h() * 0.03);
                        v = vec![[r.x0 + ix, r.y0 + iy], [r.x1 - ix, r.y0 + iy], [r.x1 - ix, r.y1 - iy], [r.x0 + ix, r.y1 - iy]];
                    }
                }
            }
            return Some(Snapped { p: densify(&v, true), g: 2 });
        }
        if ell_ok {
            if ea.min(eb) / ea.max(eb) > 0.88 { let m = (ea + eb) / 2.0; ea = m; eb = m; th = 0.0; }
            if (2.0 * th).sin().abs() < 8f32.to_radians().sin() { th = (th / std::f32::consts::FRAC_PI_2).round() * std::f32::consts::FRAC_PI_2; }
            let (s2, c2) = th.sin_cos();
            let steps = 36usize.max((std::f32::consts::PI * (ea + eb) / 3.0).ceil() as usize);
            let out = (0..=steps).map(|i| {
                let t = 2.0 * std::f32::consts::PI * i as f32 / steps as f32;
                let (u, w) = (ea * t.cos(), eb * t.sin());
                Pt::new(cx + u * c2 - w * s2, cy + u * s2 + w * c2)
            }).collect();
            return Some(Snapped { p: out, g: 2 });
        }
        return None;
    }
    if forced {
        let v = rdp(&p, 0.06 * diag);
        if v.len() >= 2 && v.len() <= 4 {
            let err = p.iter().map(|&q| (0..v.len() - 1).map(|i| seg_dist(q, v[i], v[i + 1])).fold(f32::MAX, f32::min)).sum::<f32>() / p.len() as f32;
            if err / diag < 0.035 { return Some(Snapped { p: densify(&v, false), g: 1 }); }
        }
    }
    None
}

/* ---------------- eraser ---------------- */

fn dense_pts(p: &[Pt], step: f32) -> Vec<Pt> {
    let mut out = vec![p[0]];
    for w in p.windows(2) {
        let (a, b) = (w[0], w[1]);
        let d = (b.x - a.x).hypot(b.y - a.y);
        let n = (d / step).floor() as usize;
        for k in 1..=n {
            let t = k as f32 / (n + 1) as f32;
            out.push(Pt { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, t: a.t });
        }
        out.push(b);
    }
    out
}

/// Erase a disc of radius r. "area" keeps the parts outside the disc; "stroke" removes touched strokes.
/// Returns true when something changed.
pub fn erase_disc(strokes: &mut Vec<Stroke>, x: f32, y: f32, r: f32, whole: bool) -> bool {
    let mut changed = false;
    let mut out = Vec::with_capacity(strokes.len());
    for st in strokes.drain(..) {
        let rr = r + width_of(&st) / 2.0;
        let b = st.bounds();
        if st.p.is_empty() || x < b.x0 - rr || x > b.x1 + rr || y < b.y0 - rr || y > b.y1 + rr {
            out.push(st);
            continue;
        }
        let dp = dense_pts(&st.p, if whole { (rr / 2.0).max(1.0) } else { (rr / 3.0).max(0.8) });
        let inside = |q: &Pt| (q.x - x).hypot(q.y - y) < rr;
        if whole {
            if dp.iter().any(inside) { changed = true; } else { out.push(st); }
            continue;
        }
        let mut pieces: Vec<Vec<Pt>> = vec![];
        let mut run = vec![];
        let mut hit = false;
        for q in &dp {
            if inside(q) { hit = true; if !run.is_empty() { pieces.push(std::mem::take(&mut run)); } } else { run.push(*q); }
        }
        if !run.is_empty() { pieces.push(run); }
        if !hit { out.push(st); continue; }
        changed = true;
        // a closed outline cut once is still one piece
        let closes = (dp[0].x - dp[dp.len() - 1].x).hypot(dp[0].y - dp[dp.len() - 1].y) < 4.0;
        if st.g == 2 && pieces.len() >= 2 && closes && pieces[0][0] == dp[0] && *pieces.last().unwrap().last().unwrap() == dp[dp.len() - 1] {
            let mut tail = pieces.pop().unwrap();
            tail.extend(pieces[0].drain(..));
            pieces[0] = tail;
        }
        for pc in pieces {
            if pc.len() < 2 { continue; }
            let mut ns = st.clone();
            ns.p = pc;
            if st.g == 2 { ns.g = 1; }
            out.push(ns);
        }
    }
    *strokes = out;
    changed
}

/// Erase along a path so fast moves don't skip.
pub fn erase_along(strokes: &mut Vec<Stroke>, x0: f32, y0: f32, x1: f32, y1: f32, r: f32, whole: bool) -> bool {
    let d = (x1 - x0).hypot(y1 - y0);
    let n = (d / (r / 2.0).max(2.0)).ceil().max(1.0) as usize;
    let mut changed = false;
    for k in 1..=n {
        let t = k as f32 / n as f32;
        changed |= erase_disc(strokes, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, whole);
    }
    changed
}

/* ---------------- lasso ---------------- */

pub fn point_in_poly(x: f32, y: f32, poly: &[P]) -> bool {
    let mut inside = false;
    let mut j = poly.len().wrapping_sub(1);
    for i in 0..poly.len() {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi { inside = !inside; }
        j = i;
    }
    inside
}

/// Strokes with ≥60% of their points inside the lasso.
pub fn lasso_strokes(strokes: &[Stroke], poly: &[P]) -> Vec<usize> {
    if poly.len() < 3 { return vec![]; }
    strokes.iter().enumerate().filter(|(_, st)| {
        let inside = st.p.iter().filter(|q| point_in_poly(q.x, q.y, poly)).count();
        inside as f32 >= 0.6 * st.p.len() as f32 && !st.p.is_empty()
    }).map(|(i, _)| i).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(x0: f32, x1: f32, y: f32) -> Stroke {
        Stroke { c: "#000".into(), s: 2.5, k: String::new(), d: String::new(), g: 0,
            p: (0..=20).map(|i| Pt::new(x0 + (x1 - x0) * i as f32 / 20.0, y)).collect(), rt: None }
    }
    #[test]
    fn eraser_splits_and_whole_mode_removes() {
        let mut v = vec![line(0.0, 200.0, 50.0)];
        assert!(erase_disc(&mut v, 100.0, 50.0, 12.0, false));
        assert_eq!(v.len(), 2);
        assert!(v[0].p.last().unwrap().x < 90.0 && v[1].p[0].x > 110.0);
        assert!(!erase_disc(&mut v, 100.0, 90.0, 12.0, false));
        let mut w = vec![line(0.0, 200.0, 50.0)];
        assert!(erase_disc(&mut w, 100.0, 50.0, 12.0, true));
        assert!(w.is_empty());
    }
    #[test]
    fn closed_shape_cut_once_stays_one_piece() {
        let mut sq = line(0.0, 0.0, 0.0);
        sq.g = 2;
        sq.p = densify(&[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]], true);
        let mut v = vec![sq];
        erase_disc(&mut v, 50.0, 0.0, 8.0, false);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].g, 1);
    }
    fn jitter(p: Vec<P>, j: f32) -> Vec<Pt> {
        let mut s: u32 = 7;
        p.into_iter().map(|q| {
            s = s.wrapping_mul(1103515245).wrapping_add(12345);
            let a = ((s >> 16) % 1000) as f32 / 1000.0 - 0.5;
            s = s.wrapping_mul(1103515245).wrapping_add(12345);
            let b = ((s >> 16) % 1000) as f32 / 1000.0 - 0.5;
            Pt::new(q[0] + a * j, q[1] + b * j)
        }).collect()
    }
    fn poly(v: &[P], closed: bool) -> Vec<P> {
        let mut o = vec![];
        let n = if closed { v.len() } else { v.len() - 1 };
        for i in 0..n {
            let (a, b) = (v[i], v[(i + 1) % v.len()]);
            let k = (dist(a, b) / 4.0).ceil() as usize;
            for j in 0..k { o.push([a[0] + (b[0] - a[0]) * j as f32 / k as f32, a[1] + (b[1] - a[1]) * j as f32 / k as f32]); }
        }
        o.push(if closed { [v[0][0] + 5.0, v[0][1] + 3.0] } else { *v.last().unwrap() });
        o
    }
    #[test]
    fn shapes_snap_and_writing_does_not() {
        let l = snap_shape(&jitter(poly(&[[0.0, 0.0], [180.0, 9.0]], false), 2.0), false).unwrap();
        assert_eq!(l.g, 1);
        assert!((l.p.last().unwrap().y - l.p[0].y).abs() < 0.5, "near-level line snaps level");
        let r = snap_shape(&jitter(poly(&[[0.0, 0.0], [160.0, 2.0], [162.0, 90.0], [2.0, 92.0]], true), 3.0), false).unwrap();
        assert_eq!(r.g, 2);
        let tri = snap_shape(&jitter(poly(&[[0.0, 100.0], [60.0, 0.0], [120.0, 100.0]], true), 3.0), false).unwrap();
        assert_eq!(tri.g, 2);
        let circ: Vec<P> = (0..63).map(|i| { let t = i as f32 / 60.0 * std::f32::consts::TAU; [80.0 + 60.0 * t.cos(), 80.0 + 60.0 * t.sin()] }).collect();
        assert_eq!(snap_shape(&jitter(circ, 3.0), false).unwrap().g, 2);
        let wave: Vec<P> = (0..80).map(|i| [i as f32 * 3.0, 10.0 * (i as f32 / 3.0).sin()]).collect();
        assert!(snap_shape(&jitter(wave, 2.0), false).is_none(), "cursive stays");
        let small: Vec<P> = (0..63).map(|i| { let t = i as f32 / 60.0 * std::f32::consts::TAU; [10.0 + 8.0 * t.cos(), 10.0 + 9.0 * t.sin()] }).collect();
        assert!(snap_shape(&jitter(small.clone(), 1.0), false).is_none(), "small o stays without hold");
        assert!(snap_shape(&jitter(small, 1.0), true).is_some(), "small o snaps when held");
    }
    #[test]
    fn lasso_picks_inside() {
        let v = vec![line(10.0, 50.0, 20.0), line(200.0, 300.0, 20.0)];
        let poly = [[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0]];
        assert_eq!(lasso_strokes(&v, &poly), vec![0]);
    }
}
