//! Pressure-sensitive stroke outlines.
//! A Rust port of perfect-freehand by Steve Ruiz (MIT License, https://github.com/steveruizok/perfect-freehand).

type V = [f32; 2];

const RATE_OF_PRESSURE_CHANGE: f32 = 0.275;
const FIXED_PI: f32 = std::f32::consts::PI + 0.0001;
const START_CAP_SEGMENTS: f32 = 13.0;
const END_CAP_SEGMENTS: f32 = 29.0;
const CORNER_CAP_SEGMENTS: f32 = 13.0;
const END_NOISE_THRESHOLD: f32 = 3.0;
const MIN_STREAMLINE_T: f32 = 0.15;
const STREAMLINE_T_RANGE: f32 = 0.85;
const MIN_RADIUS: f32 = 0.01;
const DEFAULT_FIRST_PRESSURE: f32 = 0.25;
const DEFAULT_PRESSURE: f32 = 0.5;

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub size: f32,
    pub thinning: f32,
    pub smoothing: f32,
    pub streamline: f32,
    pub simulate_pressure: bool,
    pub taper_start: f32,
    pub taper_end: f32,
    pub cap_start: bool,
    pub cap_end: bool,
    pub last: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { size: 16.0, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulate_pressure: true,
            taper_start: 0.0, taper_end: 0.0, cap_start: true, cap_end: true, last: false }
    }
}

fn add(a: V, b: V) -> V { [a[0] + b[0], a[1] + b[1]] }
fn sub(a: V, b: V) -> V { [a[0] - b[0], a[1] - b[1]] }
fn mul(a: V, n: f32) -> V { [a[0] * n, a[1] * n] }
fn per(a: V) -> V { [a[1], -a[0]] }
fn neg(a: V) -> V { [-a[0], -a[1]] }
fn dpr(a: V, b: V) -> f32 { a[0] * b[0] + a[1] * b[1] }
fn len(a: V) -> f32 { a[0].hypot(a[1]) }
fn dist(a: V, b: V) -> f32 { (a[0] - b[0]).hypot(a[1] - b[1]) }
fn dist2(a: V, b: V) -> f32 { let dx = a[0] - b[0]; let dy = a[1] - b[1]; dx * dx + dy * dy }
fn uni(a: V) -> V { let l = len(a); if l == 0.0 { [0.0, 0.0] } else { [a[0] / l, a[1] / l] } }
fn lrp(a: V, b: V, t: f32) -> V { add(a, mul(sub(b, a), t)) }
fn prj(a: V, b: V, c: f32) -> V { add(a, mul(b, c)) }
fn rot_around(a: V, c: V, r: f32) -> V {
    let (s, co) = r.sin_cos();
    let px = a[0] - c[0];
    let py = a[1] - c[1];
    [px * co - py * s + c[0], px * s + py * co + c[1]]
}

fn simulate_pressure(prev: f32, distance: f32, size: f32) -> f32 {
    let sp = (distance / size).min(1.0);
    let rp = (1.0 - sp).min(1.0);
    (prev + (rp - prev) * (sp * RATE_OF_PRESSURE_CHANGE)).min(1.0)
}

fn stroke_radius(size: f32, thinning: f32, pressure: f32) -> f32 {
    size * (0.5 - thinning * (0.5 - pressure))
}

struct SP {
    point: V,
    pressure: f32,
    vector: V,
    distance: f32,
    running: f32,
}

fn stroke_points(input: &[[f32; 3]], o: &Options) -> Vec<SP> {
    if input.is_empty() {
        return vec![];
    }
    let t = MIN_STREAMLINE_T + (1.0 - o.streamline) * STREAMLINE_T_RANGE;
    let mut pts: Vec<[f32; 3]> = input.to_vec();
    if pts.len() == 2 {
        let last = pts[1];
        pts.truncate(1);
        for i in 1..5 {
            let f = i as f32 / 4.0;
            let p = lrp([pts[0][0], pts[0][1]], [last[0], last[1]], f);
            pts.push([p[0], p[1], last[2]]);
        }
    }
    if pts.len() == 1 {
        let p = pts[0];
        pts.push([p[0] + 1.0, p[1] + 1.0, p[2]]);
    }
    let valid = |p: f32| p >= 0.0 && p.is_finite();
    let mut out = vec![SP {
        point: [pts[0][0], pts[0][1]],
        pressure: if valid(pts[0][2]) { pts[0][2] } else { DEFAULT_FIRST_PRESSURE },
        vector: [1.0, 1.0],
        distance: 0.0,
        running: 0.0,
    }];
    let mut reached = false;
    let mut running = 0.0;
    let max = pts.len() - 1;
    for i in 1..pts.len() {
        let prevp = out.last().unwrap().point;
        let point = if o.last && i == max { [pts[i][0], pts[i][1]] } else { lrp(prevp, [pts[i][0], pts[i][1]], t) };
        if prevp == point {
            continue;
        }
        let d = dist(point, prevp);
        running += d;
        if i < max && !reached {
            if running < o.size {
                continue;
            }
            reached = true;
        }
        out.push(SP {
            point,
            pressure: if valid(pts[i][2]) { pts[i][2] } else { DEFAULT_PRESSURE },
            vector: uni(sub(prevp, point)),
            distance: d,
            running,
        });
    }
    out[0].vector = if out.len() > 1 { out[1].vector } else { [0.0, 0.0] };
    out
}

/// Outline polygon of a stroke, from points [x, y, pressure].
pub fn get_stroke(input: &[[f32; 3]], o: &Options) -> Vec<V> {
    let points = stroke_points(input, o);
    if points.is_empty() || o.size <= 0.0 {
        return vec![];
    }
    let size = o.size;
    let total = points.last().unwrap().running;
    let taper_start = o.taper_start;
    let taper_end = o.taper_end;
    let min_distance = (size * o.smoothing).powi(2);
    let mut left: Vec<V> = vec![];
    let mut right: Vec<V> = vec![];

    let mut prev_pressure = points.iter().take(10).fold(points[0].pressure, |acc, c| {
        let p = if o.simulate_pressure { simulate_pressure(acc, c.distance, size) } else { c.pressure };
        (acc + p) / 2.0
    });
    let mut radius = stroke_radius(size, o.thinning, points.last().unwrap().pressure);
    let mut first_radius: Option<f32> = None;
    let mut prev_vector = points[0].vector;
    let mut prev_left = points[0].point;
    let mut prev_right = prev_left;
    let mut temp_left = prev_left;
    let mut temp_right = prev_right;
    let mut prev_sharp = false;

    for i in 0..points.len() {
        let SP { point, vector, distance, running, .. } = points[i];
        let mut pressure = points[i].pressure;
        let is_last = i == points.len() - 1;
        if !is_last && total - running < END_NOISE_THRESHOLD {
            continue;
        }
        if o.thinning != 0.0 {
            if o.simulate_pressure {
                pressure = simulate_pressure(prev_pressure, distance, size);
            }
            radius = stroke_radius(size, o.thinning, pressure);
        } else {
            radius = size / 2.0;
        }
        if first_radius.is_none() {
            first_radius = Some(radius);
        }
        let ts = if running < taper_start { let t = running / taper_start; t * (2.0 - t) } else { 1.0 };
        let te = if total - running < taper_end { let t = (total - running) / taper_end - 1.0; t * t * t + 1.0 } else { 1.0 };
        radius = (radius * ts.min(te)).max(MIN_RADIUS);

        let next_vector = if !is_last { points[i + 1].vector } else { vector };
        let next_dpr = if !is_last { dpr(vector, next_vector) } else { 1.0 };
        let prev_dpr = dpr(vector, prev_vector);
        let sharp = prev_dpr < 0.0 && !prev_sharp;
        let next_sharp = next_dpr < 0.0;

        if sharp || next_sharp {
            let offset = mul(per(prev_vector), radius);
            let step = 1.0 / CORNER_CAP_SEGMENTS;
            let mut t = 0.0;
            while t <= 1.0 {
                temp_left = rot_around(sub(point, offset), point, FIXED_PI * t);
                left.push(temp_left);
                temp_right = rot_around(add(point, offset), point, FIXED_PI * -t);
                right.push(temp_right);
                t += step;
            }
            prev_left = temp_left;
            prev_right = temp_right;
            if next_sharp {
                prev_sharp = true;
            }
            continue;
        }
        prev_sharp = false;

        if is_last {
            let offset = mul(per(vector), radius);
            left.push(sub(point, offset));
            right.push(add(point, offset));
            continue;
        }

        let offset = mul(per(lrp(next_vector, vector, next_dpr)), radius);
        temp_left = sub(point, offset);
        if i <= 1 || dist2(prev_left, temp_left) > min_distance {
            left.push(temp_left);
            prev_left = temp_left;
        }
        temp_right = add(point, offset);
        if i <= 1 || dist2(prev_right, temp_right) > min_distance {
            right.push(temp_right);
            prev_right = temp_right;
        }
        prev_pressure = pressure;
        prev_vector = vector;
    }

    let first_point = points[0].point;
    let last_point = if points.len() > 1 { points.last().unwrap().point } else { add(points[0].point, [1.0, 1.0]) };
    let mut start_cap: Vec<V> = vec![];
    let mut end_cap: Vec<V> = vec![];

    if points.len() == 1 {
        if !(taper_start > 0.0 || taper_end > 0.0) || o.last {
            // dot
            let r = first_radius.unwrap_or(radius);
            let start = prj(first_point, uni(per(sub(first_point, add(first_point, [1.0, 1.0])))), -r);
            let mut pts = vec![];
            let step = 1.0 / START_CAP_SEGMENTS;
            let mut t = step;
            while t <= 1.0 {
                pts.push(rot_around(start, first_point, FIXED_PI * 2.0 * t));
                t += step;
            }
            return pts;
        }
    } else {
        if taper_start > 0.0 {
        } else if o.cap_start && !right.is_empty() {
            let step = 1.0 / START_CAP_SEGMENTS;
            let mut t = step;
            while t <= 1.0 {
                start_cap.push(rot_around(right[0], first_point, FIXED_PI * t));
                t += step;
            }
        } else if !left.is_empty() && !right.is_empty() {
            let cv = sub(left[0], right[0]);
            let (a, b) = (mul(cv, 0.5), mul(cv, 0.51));
            start_cap.extend([sub(first_point, a), sub(first_point, b), add(first_point, b), add(first_point, a)]);
        }
        let direction = per(neg(points.last().unwrap().vector));
        if taper_end > 0.0 {
            end_cap.push(last_point);
        } else if o.cap_end {
            let start = prj(last_point, direction, radius);
            let step = 1.0 / END_CAP_SEGMENTS;
            let mut t = step;
            while t < 1.0 {
                end_cap.push(rot_around(start, last_point, FIXED_PI * 3.0 * t));
                t += step;
            }
        } else {
            end_cap.extend([
                add(last_point, mul(direction, radius)),
                add(last_point, mul(direction, radius * 0.99)),
                sub(last_point, mul(direction, radius * 0.99)),
                sub(last_point, mul(direction, radius)),
            ]);
        }
    }
    right.reverse();
    left.extend(end_cap);
    left.extend(right);
    left.extend(start_cap);
    left
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outline_surrounds_line() {
        let pts: Vec<[f32; 3]> = (0..30).map(|i| [i as f32 * 4.0, 50.0, 0.5]).collect();
        let o = Options { size: 4.0, last: true, ..Default::default() };
        let out = get_stroke(&pts, &o);
        assert!(out.len() > 20);
        let (mut y0, mut y1) = (f32::MAX, f32::MIN);
        for p in &out { y0 = y0.min(p[1]); y1 = y1.max(p[1]); }
        assert!(y0 < 50.0 && y1 > 50.0 && y1 - y0 < 6.0, "{y0} {y1}");
    }
    #[test]
    fn single_point_is_a_dot() {
        let out = get_stroke(&[[10.0, 10.0, 0.5]], &Options { size: 4.0, last: true, ..Default::default() });
        assert!(out.len() >= 10);
    }
}
