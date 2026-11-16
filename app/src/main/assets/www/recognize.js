/* recognize.js — handwriting → text / formula.
 *
 * Character recognition comes from the native side (Google ML Kit Digital Ink,
 * on-device). This file does the page analysis on top of it:
 *   - splitting a handful of strokes into lines,
 *   - telling formulas from prose,
 *   - 2-D formula layout: fractions, roots, exponents, subscripts, ∫/∑ limits,
 * and turns the result into AsciiMath for the math blocks.
 */
(function () {
  'use strict';

  /* ---------------- native bridge (async, callback by request id) ---------------- */
  const pending = new Map();
  let reqSeq = 1;
  const A = window.Android;

  function native(method, payload) {
    return new Promise((resolve, reject) => {
      if (!A || !A[method]) { reject(new Error('Handwriting recognition needs the Android app')); return; }
      const id = 'r' + (reqSeq++);
      pending.set(id, { resolve, reject });
      try { A[method](id, JSON.stringify(payload)); } catch (e) { pending.delete(id); reject(e); }
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Recognizer timed out')); } }, 60000);
    });
  }
  // called from Java
  function onNative(id, ok, json) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) { try { p.resolve(JSON.parse(json)); } catch (e) { p.resolve(json); } }
    else p.reject(new Error(json || 'failed'));
  }

  const status = () => (A && A.inkStatus ? A.inkStatus() : 'unavailable');   // ready | missing | unavailable
  const download = () => native('inkDownload', {});

  /** groups: array of stroke arrays → array of candidate lists [{t,s}] */
  async function recognizeGroups(groups, pre) {
    if (window.InkRecMock) return window.InkRecMock(groups);
    const payload = groups.map(g => {
      const b = bboxOf(g);
      return {
        w: Math.max(1, b.x1 - b.x0), h: Math.max(1, b.y1 - b.y0), pre: pre || '',
        strokes: g.map(st => st.p.map(q => [Math.round((q[0] - b.x0) * 10) / 10, Math.round((q[1] - b.y0) * 10) / 10, q[3] || 0]))
      };
    });
    return native('inkRecognize', payload);
  }

  /* ---------------- geometry ---------------- */
  function bbox(st) {
    if (st._b) return st._b;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of st.p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    const b = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    Object.defineProperty(st, '_b', { value: b, enumerable: false, configurable: true });
    return b;
  }
  function bboxOf(list) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const it of list) {
      const b = it.p ? bbox(it) : it.b;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  function charHeight(strokes) {
    const hs = strokes.map(s => bbox(s)).filter(b => b.h > 2 && b.h > 0.35 * b.w).map(b => b.h);
    return Math.max(12, median(hs) || median(strokes.map(s => Math.max(bbox(s).h, bbox(s).w))) || 24);
  }
  const isFlat = (b, H) => b.w >= 0.35 * H && b.h <= 0.32 * b.w && b.h <= 0.45 * H;
  const isDot = (b, H) => b.w < 0.22 * H && b.h < 0.22 * H;

  /* ---------------- lines ---------------- */
  function splitLines(strokes) {
    if (!strokes.length) return [];
    const H = charHeight(strokes);
    const items = strokes.map(s => ({ s, b: bbox(s) })).sort((a, b) => a.b.y0 - b.b.y0);
    let lines = [];
    for (const it of items) {
      let best = null, bestOv = 0;
      for (const L of lines) {
        const ov = Math.min(L.y1, it.b.y1) - Math.max(L.y0, it.b.y0);
        const need = Math.min(it.b.h, L.y1 - L.y0) * 0.25;
        const near = it.b.h < 0.75 * H && (it.b.y0 - L.y1) < 0.35 * H && (L.y0 - it.b.y1) < 0.35 * H;
        if ((ov > need || near) && ov > bestOv - 1e9) { if (!best || ov > bestOv) { best = L; bestOv = ov; } }
      }
      if (best) { best.items.push(it); best.y0 = Math.min(best.y0, it.b.y0); best.y1 = Math.max(best.y1, it.b.y1); }
      else lines.push({ items: [it], y0: it.b.y0, y1: it.b.y1 });
    }
    // lines made only of small glyphs (exponents, subscripts, limits) belong to the nearest line
    let again = true;
    while (again) {
      again = false;
      for (const L of lines) {
        if (L.items.some(i => i.b.h >= 0.75 * H && !isFlat(i.b, H))) continue;
        let best = null, bestGap = 1e9;
        for (const M of lines) {
          if (M === L) continue;
          const gap = Math.max(M.y0 - L.y1, L.y0 - M.y1, 0);
          const xNear = M.items.some(o => L.items.some(i => Math.abs(o.b.cx - i.b.cx) < Math.max(o.b.w, i.b.w) / 2 + 1.2 * H));
          if (gap < 0.45 * H && xNear && gap < bestGap) { best = M; bestGap = gap; }
        }
        if (best) {
          best.items.push(...L.items); best.y0 = Math.min(best.y0, L.y0); best.y1 = Math.max(best.y1, L.y1);
          lines = lines.filter(x => x !== L); again = true; break;
        }
      }
    }
    // fraction bars glue the line above and below together
    let merged = true;
    while (merged) {
      merged = false;
      outer:
      for (const L of lines) {
        for (const it of L.items) {
          if (!isFlat(it.b, H) || it.b.w < 0.9 * H) continue;
          const touches = (M, above) => M.items.some(o => o !== it && o.b.cx > it.b.x0 - 0.1 * H && o.b.cx < it.b.x1 + 0.1 * H &&
            (above ? (it.b.cy - o.b.y1 < 0.9 * H && o.b.cy < it.b.cy) : (o.b.y0 - it.b.cy < 0.9 * H && o.b.cy > it.b.cy)));
          const up = lines.find(M => touches(M, true)), dn = lines.find(M => touches(M, false));
          if (up && dn && (up !== L || dn !== L)) {
            for (const M of [up, dn]) {
              if (!M || M === L) continue;
              L.items.push(...M.items); L.y0 = Math.min(L.y0, M.y0); L.y1 = Math.max(L.y1, M.y1);
              lines = lines.filter(x => x !== M);
            }
            merged = true;
            break outer;
          }
        }
      }
    }
    return lines.sort((a, b) => a.y0 - b.y0).map(L => L.items.map(i => i.s).sort((a, b) => bbox(a).x0 - bbox(b).x0));
  }

  /* ---------------- formula structure ---------------- */
  function radicalContents(st, others, H) {
    const b = bbox(st);
    if (b.w < 0.8 * H || b.h < 0.6 * H) return null;
    if (b.w < 0.75 * b.h) return null;                       // narrow tall strokes are ∫, ( or letters, not √
    // right part of a √ is a near-horizontal line along the top
    const right = st.p.filter(q => q[0] > b.x0 + 0.55 * b.w);
    if (right.length < 2) return null;
    let ry0 = 1e9, ry1 = -1e9, rx0 = 1e9, rx1 = -1e9;
    for (const q of right) { ry0 = Math.min(ry0, q[1]); ry1 = Math.max(ry1, q[1]); rx0 = Math.min(rx0, q[0]); rx1 = Math.max(rx1, q[0]); }
    if (ry1 - ry0 > 0.15 * b.h + 3 || ry0 - b.y0 > 0.15 * b.h + 3) return null;   // flat bar along the top
    if (rx1 - rx0 < 0.3 * b.w) return null;
    // left part dips down: the lowest point lies in the left 45%
    let low = st.p[0];
    for (const q of st.p) if (q[1] > low[1]) low = q;
    if (low[0] > b.x0 + 0.5 * b.w) return null;
    const li = st.p.indexOf(low);
    if (li < 0.08 * st.p.length || li > 0.9 * st.p.length) return null;   // a √ bottoms out mid-stroke
    const inside = others.filter(o => o !== st && bbox(o).x0 > b.x0 + 0.2 * b.w && bbox(o).cx > b.x0 + 0.25 * b.w && bbox(o).cx < b.x1 + 0.1 * H && bbox(o).cy > b.y0 && bbox(o).cy < b.y1 + 0.1 * H);
    return inside.length ? inside : null;
  }

  /** Build a tree of nodes: {kind:'sym', strokes, b} | {kind:'frac', num, den, b} | {kind:'sqrt', body, b} */
  function structure(strokes, H) {
    H = H || charHeight(strokes);
    let rest = strokes.slice();
    const nodes = [];
    // fractions, widest bar first
    const bars = rest.filter(s => isFlat(bbox(s), H) && bbox(s).w >= 0.9 * H).sort((a, b) => bbox(b).w - bbox(a).w);
    for (const bar of bars) {
      if (!rest.includes(bar)) continue;
      const B = bbox(bar);
      const inSpan = (o) => o !== bar && bbox(o).cx > B.x0 - 0.1 * H && bbox(o).cx < B.x1 + 0.1 * H;
      const num = rest.filter(o => inSpan(o) && bbox(o).cy < B.cy && B.cy - bbox(o).y1 < 2.4 * H);
      const den = rest.filter(o => inSpan(o) && bbox(o).cy > B.cy && bbox(o).y0 - B.cy < 2.4 * H);
      if (!num.length || !den.length) continue;
      // a bar that is about as wide as its neighbours and level with them is a minus sign, not a fraction
      const all = num.concat(den, [bar]);
      rest = rest.filter(o => !all.includes(o));
      nodes.push({ kind: 'frac', num: structure(num, H), den: structure(den, H), b: bboxOf(all) });
    }
    // square roots
    for (const st of rest.slice().sort((a, b) => bbox(b).w - bbox(a).w)) {
      if (!rest.includes(st)) continue;
      const inside = radicalContents(st, rest, H);
      if (!inside) continue;
      rest = rest.filter(o => o !== st && !inside.includes(o));
      nodes.push({ kind: 'sqrt', body: structure(inside, H), b: bboxOf(inside.concat([st])) });
    }
    // remaining strokes → symbols (strokes that overlap horizontally belong together)
    const sorted = rest.slice().sort((a, b) => bbox(a).x0 - bbox(b).x0);
    const syms = [];
    for (const st of sorted) {
      const b = bbox(st);
      const last = syms[syms.length - 1];
      if (last) {
        const L = last.b;
        const ov = Math.min(L.x1, b.x1) - Math.max(L.x0, b.x0);
        const narrow = Math.max(1, Math.min(L.w, b.w));
        const dotOver = isDot(b, H) && b.cx > L.x0 - 0.15 * H && b.cx < L.x1 + 0.15 * H && b.y1 < L.y0 + 0.2 * H; // i, j
        const stacked = isFlat(b, H) && isFlat(L, H) && ov > 0.5 * narrow;                                        // =
        const vgap = Math.max(b.y0 - L.y1, L.y0 - b.y1, 0);
        const centerIn = (b.cx >= L.x0 - 1 && b.cx <= L.x1 + 1) || (L.cx >= b.x0 - 1 && L.cx <= b.x1 + 1);
        // a small mark above/below a much taller symbol is a limit or index, not part of it (∫ with ∞ under it)
        const big = Math.max(L.w, L.h) > Math.max(b.w, b.h) ? L : b, sm = big === L ? b : L;
        const yOv = Math.min(big.y1, sm.y1) - Math.max(big.y0, sm.y0);
        const separate = Math.max(big.w, big.h) > 2.2 * Math.max(sm.w, sm.h) && yOv < 0.5 * sm.h;
        if (!separate && (((ov > 0.45 * narrow || centerIn) && vgap < 0.3 * H) || dotOver || stacked)) {
          last.strokes.push(st); last.b = bboxOf(last.strokes); continue;
        }
      }
      syms.push({ kind: 'sym', strokes: [st], b });
    }
    return nodes.concat(syms).sort((a, b) => a.b.x0 - b.b.x0);
  }

  /* ---------------- symbol choice ---------------- */
  const MAP = {
    '×': 'xx', '✕': 'xx', '÷': '-:', '−': '-', '–': '-', '—': '-', '·': '*', '•': '*', '∞': 'oo', 'π': 'pi', 'Σ': 'sum', '∑': 'sum',
    '∫': 'int', '√': 'sqrt', '≤': '<=', '≥': '>=', '≠': '!=', '±': '+-', '→': '->', '≈': '~~', 'α': 'alpha', 'β': 'beta',
    'γ': 'gamma', 'δ': 'delta', 'Δ': 'Delta', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'σ': 'sigma', 'φ': 'phi', 'ω': 'omega',
    'Ω': 'Omega', '∂': 'del', '∇': 'grad', '°': '@', '′': "'", '’': "'", '‘': "'", '“': '"', '”': '"'
  };
  const OK1 = /^[A-Za-z0-9+\-=()\[\].,<>\/|!'*:]$/;

  function chooseSymbol(cands, sym, H) {
    const b = sym.b;
    // pure geometry first
    if (sym.strokes.length === 1 && isFlat(b, H)) return '-';
    if (sym.strokes.length === 2 && sym.strokes.every(s => isFlat(bbox(s), H))) return '=';
    if (sym.strokes.length === 1 && isDot(b, H)) return b.cy < 0 ? '*' : '.';
    const tall = b.h > 1.45 * H;
    let pick = null;
    for (const c of cands || []) {
      let t = (c.t || '').trim();
      if (!t) continue;
      if (MAP[t]) { pick = MAP[t]; break; }
      if (t.length > 1) {
        if (/^(\d+|[A-Za-z])$/.test(t)) { pick = t; break; }
        continue;
      }
      if (OK1.test(t)) { pick = t; break; }
    }
    if (!pick) pick = (cands && cands[0] && cands[0].t) ? cands[0].t.trim().slice(0, 1) : '?';
    return refine(pick, sym, H);
  }

  /* shape tests for symbols the text recognizer often gets wrong */
  function segIntersect(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function isPlusShape(sym) {
    if (sym.strokes.length !== 2) return false;
    const [b1, b2] = sym.strokes.map(st => bbox(st));
    const hz = b1.w > 1.8 * b1.h ? b1 : b2.w > 1.8 * b2.h ? b2 : null;
    const vt = b1.h > 1.8 * b1.w ? b1 : b2.h > 1.8 * b2.w ? b2 : null;
    if (!hz || !vt || hz === vt) return false;
    const r = hz.w / vt.h;
    if (r < 0.45 || r > 2.2) return false;
    const fx = (vt.cx - hz.x0) / hz.w, fy = (hz.cy - vt.y0) / vt.h;
    return fx > 0.25 && fx < 0.75 && fy > 0.3 && fy < 0.72;
  }
  function isInfinityShape(sym, H) {
    const b = sym.b;
    if (b.w < 1.25 * b.h || b.w > 4.5 * b.h || b.h < 0.15 * H) return false;
    // one (or two) strokes that cross themselves near the middle
    const pts = sym.strokes.flatMap(st => st.p);
    // passes through (nearly) the same spot twice, near the middle
    const gap = Math.max(4, Math.floor(pts.length / 5));
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - b.cx) > 0.2 * b.w) continue;
      for (let j = i + gap; j < pts.length; j++) {
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 0.07 * b.w + 1) return true;
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 3; j < pts.length - 1; j++) {
        if (segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          if (Math.abs(mx - b.cx) < 0.25 * b.w) return true;
        }
      }
    }
    return false;
  }

  /** Geometry-based corrections to a recognised character. */
  function refine(pick, sym, H) {
    const b = sym.b;
    if (isPlusShape(sym)) return '+';
    if (isInfinityShape(sym, H) && !/^\d$/.test(pick)) return 'oo';
    if (sym.strokes.length === 1 && isFlat(b, H)) return '-';
    if (pick === '_' || pick === '~' && sym.strokes.length === 1 && isFlat(b, H)) pick = '-';
    // a very tall, narrow S / f / ∫ is an integral sign (J, l, 1 stay letters/digits)
    if (b.h > 1.7 * H && /^(S|s|f|ʃ|int)$/.test(pick) && b.w < 0.7 * b.h) pick = 'int';
    else if (b.h > 1.7 * H && /^(E|Σ|sum)$/.test(pick)) pick = 'sum';
    // case from size: small capitals of look-alike letters are lowercase
    if (/^[CKOPSUVWXZ]$/.test(pick) && b.h < 0.72 * H) pick = pick.toLowerCase();
    return pick;
  }

  function fixDigitsContext(toks) {
    // O/o/l/I between digits are 0 and 1
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind !== 'sym') continue;
      const nb = [toks[i - 1], toks[i + 1]].filter(x => x && x.kind === 'sym' && /^\d$/.test(x.ch));
      if (!nb.length) continue;
      if (/^[oO]$/.test(t.ch)) t.ch = '0';
      if (/^[lI|]$/.test(t.ch)) t.ch = '1';
      if (t.ch === 's' || t.ch === 'S') t.ch = '5';
      if (t.ch === 'z' || t.ch === 'Z') t.ch = '2';
    }
  }

  /* ---------------- layout → AsciiMath ---------------- */
  const BIGOPS = new Set(['int', 'sum']);
  const OPS = new Set(['-', '+', '=', '*', 'xx', '<', '>', '<=', '>=', '!=', '+-', '->', '~~', '-:', ',', '.']);
  const isOp = (n) => n.kind === 'sym' && OPS.has(n.ch);

  function emit(n) {
    if (n.kind === 'frac') return '(' + emitRow(n.num) + ')/(' + emitRow(n.den) + ')';
    if (n.kind === 'sqrt') return 'sqrt(' + emitRow(n.body) + ')';
    return n.ch;
  }

  function joinTokens(parts) {
    let s = '';
    let prev = '';
    for (const p of parts) {
      if (!p) continue;
      const needSpace = s && /[_^]/.test(prev) && /^[A-Za-z0-9(]/.test(p) || s && (/[A-Za-z]$/.test(s) && /^[A-Za-z]/.test(p) && (p.length > 1 || /[A-Za-z]{2,}$/.test(s.split(/[^A-Za-z]/).pop() || '')))
        || (s && OPS.has(p)) || (s && /^(xx|int|sum|oo|pi|sqrt)/.test(p)) || /(xx|int|sum|oo|pi|\)|-|\+|=)$/.test(s) && /^[A-Za-z0-9(]/.test(p);
      s += (needSpace ? ' ' : '') + p;
      prev = p;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /** nodes: sorted left→right, with .ch for symbols. */
  let rowH = 24;
  function emitRow(nodes, flat) {
    if (!nodes || !nodes.length) return '';
    const plain = nodes.filter(n => n.kind === 'sym' && !isOp(n) && !BIGOPS.has(n.ch) && !isDot(n.b, 999));
    const refH = plain.length >= 3 ? median(plain.map(n => n.b.h)) : Math.max(rowH, median(plain.map(n => n.b.h)) || 0);
    const refCy = median((plain.length ? plain : nodes).map(n => n.b.cy));
    const rowBase = plain.length >= 2 ? median(plain.map(n => n.b.y1)) : null;   // where letters sit
    // limits of ∫ / ∑ written slightly to the left of the sign: move them right behind it
    nodes = nodes.slice();
    for (const op of nodes.filter(n => n.kind === 'sym' && BIGOPS.has(n.ch))) {
      const B = op.b;
      const lims = nodes.filter(m => m !== op && m.b.x1 > B.x0 - 0.9 * refH && m.b.x0 < B.x0 &&
        m.b.h < 0.8 * refH && (m.b.y0 > B.y1 - 0.45 * B.h || m.b.y1 < B.y0 + 0.45 * B.h));
      if (!lims.length) continue;
      nodes = nodes.filter(m => !lims.includes(m));
      nodes.splice(nodes.indexOf(op) + 1, 0, ...lims.sort((a, c) => a.b.x0 - c.b.x0));
    }
    const out = [];
    let i = 0;
    let base = null;
    while (i < nodes.length) {
      const n = nodes[i];
      // limits of ∫ and ∑
      if (n.kind === 'sym' && BIGOPS.has(n.ch)) {
        const B = n.b;
        const up = [], dn = [];
        let j = i + 1;
        while (j < nodes.length) {
          const m = nodes[j];
          const near = m.b.x0 < B.x0 || (n.ch === 'sum' ? (m.b.cx < B.x1 + 0.2 * refH) : (m.b.x0 < B.x1 + 0.9 * refH));
          if (!near) break;
          if (m.b.h < 0.8 * refH && m.b.y1 < B.y0 + 0.45 * B.h) { up.push(m); j++; continue; }
          if (m.b.h < 0.8 * refH && m.b.y0 > B.y1 - 0.45 * B.h) { dn.push(m); j++; continue; }
          break;
        }
        let t = n.ch;
        if (dn.length) t += '_(' + emitRow(dn) + ')';
        if (up.length) t += '^(' + emitRow(up) + ')';
        out.push(t);
        base = null;
        i = j;
        continue;
      }
      // superscript / subscript relative to the previous base symbol
      if (base && !flat && !isOp(n) && n.kind === 'sym') {
        let B = base.b.h > 0.4 * refH ? base.b : { cy: refCy, h: refH, y0: refCy - refH / 2, y1: refCy + refH / 2 };
        // letters that dip below the line (y, p, g, J…): compare against the body of the letter, not its tail
        const dips = /^[gjpqyY]$/.test(base.ch || '') || (rowBase !== null && B.y1 > rowBase + 0.3 * refH && B.y0 > rowBase - 1.1 * refH);
        if (base.kind === 'sym' && dips) {
          const y1 = Math.min(B.y1, rowBase !== null ? Math.max(rowBase, B.y0 + 0.45 * B.h) : B.y0 + 0.62 * B.h);
          const h = Math.max(4, y1 - B.y0);
          B = { y0: B.y0, y1, h, cy: B.y0 + h / 2 };
        }
        const notBig = n.b.h < 1.3 * Math.max(B.h, refH * 0.8);
        // raised: sits above the middle of the base; lowered: starts below the middle of the base
        const isSup = notBig && n.b.cy < B.cy - 0.3 * B.h && n.b.y1 < B.cy + 0.15 * B.h;
        const isSub = notBig && n.b.cy > B.cy + 0.3 * B.h && n.b.y0 > B.cy - 0.12 * B.h;
        if (isSup || isSub) {
          const grp = [n];
          let j = i + 1;
          while (j < nodes.length) {
            const m = nodes[j];
            const same = isSup ? (m.b.cy < B.cy - 0.2 * B.h && m.b.y1 < B.cy + 0.15 * B.h)
                               : (m.b.cy > B.cy + 0.2 * B.h && m.b.y0 > B.cy - 0.15 * B.h);
            if (!same || m.b.x0 > grp[grp.length - 1].b.x1 + 0.9 * refH) break;
            grp.push(m); j++;
          }
          if (isSup && grp.length === 1 && grp[0].kind === 'sym') {
            // a lone raised character is almost always a digit: z→2, o→0, l→1, s→5, g/q→9
            const map = { z: '2', Z: '2', o: '0', O: '0', l: '1', I: '1', '|': '1', s: '5', S: '5', g: '9', q: '9', b: '6' };
            if (map[grp[0].ch]) grp[0].ch = map[grp[0].ch];
          }
          const inner = emitRow(grp, isSub);   // subscripts stay one level (n_{p0}); superscripts may nest (e^{-x^2})
          out[out.length - 1] = out[out.length - 1] + (isSup ? '^' : '_') + (inner.length === 1 ? inner : '(' + inner + ')');
          i = j;
          continue;
        }
      }
      out.push(emit(n));
      if (!isOp(n)) base = n;
      else base = null;
      i++;
    }
    return joinTokens(out);
  }

  function collectSyms(nodes, acc) {
    for (const n of nodes) {
      if (n.kind === 'sym') acc.push(n);
      else if (n.kind === 'frac') { collectSyms(n.num, acc); collectSyms(n.den, acc); }
      else if (n.kind === 'sqrt') collectSyms(n.body, acc);
    }
    return acc;
  }

  function rowsOf(nodes, acc) {
    acc.push(nodes.filter(n => n.kind === 'sym'));
    for (const n of nodes) {
      if (n.kind === 'frac') { rowsOf(n.num, acc); rowsOf(n.den, acc); }
      else if (n.kind === 'sqrt') rowsOf(n.body, acc);
    }
    return acc;
  }
  const charsOf = (t) => Array.from((t || '').replace(/\s+/g, ''));
  const norm = (c) => MAP[c] || c;

  async function recognizeMath(strokes) {
    const H = charHeight(strokes);
    const tree = structure(strokes, H);
    // 1) read each row as a whole — the recognizer is far better with context than with lone symbols —
    //    then map its characters onto the symbols found by the layout analysis (left to right).
    const rows = rowsOf(tree, []).filter(r => r.length);
    const rowCands = await recognizeGroups(rows.map(r => r.flatMap(n => n.strokes)));
    const leftovers = [];
    rows.forEach((r, k) => {
      const cands = (rowCands[k] || []).map(c => c.t || '');
      for (const t of cands) {
        const ch = charsOf(t);
        if (ch.length === r.length) { r.forEach((n, i) => { n.ch = refine(norm(ch[i]), n, H); }); return; }
      }
      // tiny marks (dots, primes) are often dropped by the recognizer: try matching without them
      const solid = r.filter(n => !isDot(n.b, H));
      if (solid.length < r.length) {
        for (const t of cands) {
          const ch = charsOf(t);
          if (ch.length === solid.length) {
            solid.forEach((n, i) => { n.ch = refine(norm(ch[i]), n, H); });
            leftovers.push(...r.filter(n => isDot(n.b, H)));
            return;
          }
        }
      }
      leftovers.push(...r);
    });
    // 2) anything that couldn't be matched is recognised symbol by symbol
    if (leftovers.length) {
      const cands = await recognizeGroups(leftovers.map(s => s.strokes));
      leftovers.forEach((s, k) => { s.ch = chooseSymbol(cands[k], s, H); });
    }
    // 3) your own handwriting samples (✍ Train) correct what the text recogniser can't read
    if (window.Train && Train.has) {
      for (const sym of collectSyms(tree, [])) {
        if (sym.strokes.length === 1 && (isFlat(sym.b, H) || isDot(sym.b, H))) continue;
        if (isPlusShape(sym) || isInfinityShape(sym, H)) continue;
        const r = Train.classify(sym.strokes);
        if (!r.length || r[0].token === sym.ch) continue;
        const best = r[0], second = r.find(x => x.token !== best.token);
        const margin = second ? second.d / Math.max(1e-6, best.d) : 9;
        const special = !/^[A-Za-z0-9]$/.test(best.token);
        // matches score ~0.3–0.7, different symbols ~1.5+; letters/digits need a clearer win to override the recogniser
        if ((special && best.d < 1.4 && margin > 1.3) || (best.d < 0.9 && margin > 1.8) || (sym.ch === '?' && best.d < 2)) {
          sym.ch = best.token;
        }
      }
    }
    const fixRows = (nodes) => { fixDigitsContext(nodes); nodes.forEach(n => { if (n.num) { fixRows(n.num); fixRows(n.den); } if (n.body) fixRows(n.body); }); };
    fixRows(tree);
    rowH = H;
    let ascii = emitRow(tree);
    ascii = ascii.replace(/\bs i n\b/g, 'sin').replace(/\bc o s\b/g, 'cos').replace(/\bl n\b/g, 'ln');
    return { ascii, tree };
  }

  /* ---------------- text ---------------- */
  async function recognizeTextLines(lines) {
    const res = await recognizeGroups(lines);
    return res.map(c => (c || []).map(x => x.t));
  }

  /** Does a line have formula structure (fractions, roots, raised/lowered symbols)? */
  function looksStructured(strokes) {
    const H = charHeight(strokes);
    const tree = structure(strokes, H);
    if (tree.some(n => n.kind !== 'sym')) return true;
    const syms = tree.filter(n => !isFlat(n.b, H) && !isDot(n.b, H));
    if (syms.length < 2) return false;
    const cy = median(syms.map(n => n.b.cy));
    let off = 0;
    for (let i = 1; i < syms.length; i++) {
      const p = syms[i - 1], n = syms[i];
      if (n.b.h < 0.75 * p.b.h && Math.abs(n.b.cy - p.b.cy) > 0.38 * p.b.h && n.b.x0 - p.b.x1 < 0.6 * H) off++;
    }
    return off > 0 && Math.abs(cy) >= 0;
  }

  function looksLikeMathText(t) {
    if (!t) return false;
    const s = t.trim();
    if (/[=^√∫∑π≤≥≠±×÷]/.test(s)) return true;
    const letters = (s.match(/[A-Za-z]{3,}/g) || []).filter(w => !/^(sin|cos|tan|log|exp|lim|max|min)$/i.test(w));
    if (!letters.length && /[0-9]/.test(s) && /[+\-*/]/.test(s)) return true;
    return false;
  }

  /**
   * Convert strokes. mode: 'text' | 'math' | 'auto'.
   * Returns [{type:'text'|'math', src, alts:[...]}] (consecutive text lines merged).
   */
  async function convert(strokes, mode) {
    strokes = strokes.filter(s => s.k !== 'hl' && s.p && s.p.length);
    if (!strokes.length) return [];
    if (mode === 'math') {
      const lines = splitLines(strokes);
      const out = [];
      for (const L of lines) out.push({ type: 'math', src: (await recognizeMath(L)).ascii, strokes: L });
      return out;
    }
    const lines = splitLines(strokes);
    const texts = await recognizeTextLines(lines);
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      const alts = texts[i] || [];
      const t = alts[0] || '';
      let isMath = false;
      if (mode === 'auto') isMath = looksStructured(lines[i]) || looksLikeMathText(t);
      if (isMath) {
        blocks.push({ type: 'math', src: (await recognizeMath(lines[i])).ascii, alts: [t], strokes: lines[i] });
      } else {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') { last.src += '\n' + t; last.alts = null; last.strokes = last.strokes.concat(lines[i]); }
        else blocks.push({ type: 'text', src: t, alts: alts.slice(0, 4), strokes: lines[i].slice() });
      }
    }
    return blocks;
  }

  window.InkRec = { status, download, onNative, convert, splitLines, structure, recognizeMath, emitRow, charHeight, bbox, looksStructured, looksLikeMathText };
})();
