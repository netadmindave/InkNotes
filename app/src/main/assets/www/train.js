/* train.js — personal handwriting samples.
 * You write symbols a few times; each sample is stored as a normalised point cloud and
 * matched with the $P point-cloud recogniser (Vatavu, Anthony & Wobbrock, 2012).
 * Used by recognize.js to correct symbols the text recogniser can't read (∞, π, ∑, Greek…).
 */
(function () {
  'use strict';
  const N = 32;

  // [shown, AsciiMath token]
  const SYMBOLS = [
    ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'],
    ['+', '+'], ['−', '-'], ['=', '='], ['×', 'xx'], ['÷', '-:'], ['<', '<'], ['>', '>'], ['(', '('], [')', ')'],
    ['∫', 'int'], ['∑', 'sum'], ['∏', 'prod'], ['√', 'sqrt'], ['∞', 'oo'], ['∂', 'del'], ['∇', 'grad'],
    ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['Δ', 'Delta'], ['ε', 'epsilon'], ['θ', 'theta'],
    ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'],
    ['ω', 'omega'], ['Ω', 'Omega'],
    ['x', 'x'], ['y', 'y'], ['z', 'z'], ['t', 't'], ['s', 's'], ['n', 'n'], ['u', 'u'], ['v', 'v'], ['a', 'a'],
    ['b', 'b'], ['c', 'c'], ['d', 'd'], ['e', 'e'], ['k', 'k'], ['T', 'T'], ['J', 'J']
  ];
  const TOKEN = Object.fromEntries(SYMBOLS.map(([s, t]) => [s, t]));

  let store = { getPref: () => '', setPref: () => { } };
  let samples = {};   // shown symbol -> [cloud, ...]

  function init(st) {
    store = st;
    try { samples = JSON.parse(store.getPref('hwSamples') || '{}') || {}; } catch (e) { samples = {}; }
  }
  const save = () => store.setPref('hwSamples', JSON.stringify(samples));

  /* ---------- $P ---------- */
  function cloudFrom(strokes) {
    let pts = [];
    strokes.forEach((st, id) => st.p.forEach(q => pts.push({ x: q[0], y: q[1], id })));
    if (pts.length < 2) return null;
    pts = resample(pts, N);
    // scale uniformly to a unit box, then centre on the centroid
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const sz = Math.max(x1 - x0, y1 - y0) || 1;
    pts = pts.map(p => ({ x: (p.x - x0) / sz, y: (p.y - y0) / sz, id: p.id }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    // keep aspect information: store as [x, y] pairs rounded
    return pts.map(p => [+(p.x - cx).toFixed(3), +(p.y - cy).toFixed(3)]);
  }

  function resample(pts, n) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const I = len / (n - 1) || 1;
    const out = [pts[0]];
    let D = 0;
    const src = pts.slice();
    for (let i = 1; i < src.length; i++) {
      if (src[i].id !== src[i - 1].id) continue;
      const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
      if (D + d >= I && d > 0) {
        const t = (I - D) / d;
        const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y), id: src[i].id };
        out.push(q);
        src.splice(i, 0, q);
        D = 0;
      } else D += d;
    }
    while (out.length < n) out.push(src[src.length - 1]);
    return out.slice(0, n);
  }

  function cloudDistance(a, b, start) {
    const n = a.length, matched = new Array(n).fill(false);
    let sum = 0, i = start;
    do {
      let min = Infinity, idx = -1;
      for (let j = 0; j < n; j++) {
        if (matched[j]) continue;
        const d = Math.hypot(a[i][0] - b[j][0], a[i][1] - b[j][1]);
        if (d < min) { min = d; idx = j; }
      }
      matched[idx] = true;
      const w = 1 - ((i - start + n) % n) / n;
      sum += w * min;
      i = (i + 1) % n;
    } while (i !== start);
    return sum;
  }

  function greedy(a, b) {
    const step = Math.max(1, Math.floor(Math.pow(a.length, 0.5)));
    let min = Infinity;
    for (let i = 0; i < a.length; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
    return min;
  }

  /** Best matches for some strokes: [{sym, token, d}] sorted by distance (one entry per symbol). */
  function classify(strokes) {
    const c = cloudFrom(strokes);
    if (!c) return [];
    const res = [];
    for (const [sym, list] of Object.entries(samples)) {
      if (!list || !list.length) continue;
      let best = Infinity;
      for (const t of list) best = Math.min(best, greedy(c, t));
      res.push({ sym, token: TOKEN[sym] || sym, d: best });
    }
    return res.sort((a, b) => a.d - b.d);
  }

  function addSample(sym, strokes) {
    const c = cloudFrom(strokes);
    if (!c) return false;
    (samples[sym] = samples[sym] || []).push(c);
    if (samples[sym].length > 6) samples[sym].shift();
    save();
    return true;
  }
  const count = (sym) => (samples[sym] || []).length;
  const total = () => Object.values(samples).reduce((s, l) => s + l.length, 0);
  function clear(sym) { if (sym) delete samples[sym]; else samples = {}; save(); }

  window.Train = { init, SYMBOLS, TOKEN, classify, addSample, count, total, clear, get has() { return total() > 0; } };
})();
