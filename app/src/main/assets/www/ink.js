/* ink.js — S Pen handwriting areas, stored as vector strokes.
 * Tools: pen, pencil, highlighter, eraser, lasso. Input routing (pen / finger / two-finger) lives in app.js.
 * Stroke: {c: colour, s: size, k: kind ('' | 'pc' | 'hl'), p: [[x, y, pressure, t], ...]}
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 900; // logical width of every ink area

  const tool = { kind: 'pen', color: '#1d3557', size: 2.5, dash: '', shapes: true, eraserSize: 14, eraserMode: 'area' };

  function pathFromOutline(pts) {
    if (!pts.length) return '';
    const avg = (a, b) => (a + b) / 2;
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1) + ' Q';
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      d += x0.toFixed(1) + ',' + y0.toFixed(1) + ' ' + avg(x0, x1).toFixed(1) + ',' + avg(y0, y1).toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  function strokePath(st) {
    const hasPressure = st.p.some(q => q[2] !== 0.5);
    let o;
    // st.s ≈ line width at medium pressure (perfect-freehand's size is a radius scale)
    if (st.k === 'hl') o = { size: st.s * 3.2, thinning: 0, smoothing: 0.7, streamline: 0.6, simulatePressure: false };
    else if (st.k === 'pc') o = { size: st.s * 0.75, thinning: 0.3, smoothing: 0.5, streamline: 0.4, simulatePressure: !hasPressure };
    else o = { size: st.s * 1.0, thinning: 0.5, smoothing: 0.6, streamline: 0.45, simulatePressure: !hasPressure,
      start: { taper: hasPressure ? 0 : 6, cap: true }, end: { taper: hasPressure ? 0 : 10, cap: true } };
    o.last = true;
    return pathFromOutline(PF.getStroke(st.p.map(q => [q[0], q[1], q[2]]), o));
  }

  /** Centre-line path, for dashed/dotted lines and snapped shapes. */
  function centreline(st) {
    const P = st.p;
    if (!P.length) return '';
    let d = 'M' + P[0][0].toFixed(1) + ',' + P[0][1].toFixed(1);
    if (st.g) { for (let i = 1; i < P.length; i++) d += ' L' + P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1); }
    else {
      for (let i = 1; i < P.length - 1; i++) {
        const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
        d += ' Q' + P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1) + ' ' + mx.toFixed(1) + ',' + my.toFixed(1);
      }
      const L = P[P.length - 1];
      d += ' L' + L[0].toFixed(1) + ',' + L[1].toFixed(1);
    }
    return d + (st.g === 2 ? ' Z' : '');
  }
  const widthOf = (st) => st.k === 'hl' ? st.s * 4.5 : st.k === 'pc' ? st.s * 0.8 : st.s;

  function pathEl(st) {
    const p = document.createElementNS(NS, 'path');
    const op = st.k === 'hl' ? '0.32' : st.k === 'pc' ? '0.82' : null;
    if (st.d || st.g) {
      const w = widthOf(st);
      p.setAttribute('d', centreline(st));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', st.c);
      p.setAttribute('stroke-width', w.toFixed(2));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      if (st.d === 'dash') p.setAttribute('stroke-dasharray', (w * 3.2).toFixed(1) + ' ' + (w * 2.6).toFixed(1));
      if (st.d === 'dot') p.setAttribute('stroke-dasharray', '0 ' + (w * 2.4).toFixed(1));
      if (op) p.setAttribute('stroke-opacity', op);
    } else {
      p.setAttribute('d', strokePath(st));
      p.setAttribute('fill', st.c);
      if (op) p.setAttribute('fill-opacity', op);
    }
    return p;
  }

  function setup(svg, block) {
    if (!block.w) block.w = W;
    if (!block.h) block.h = 260;
    svg.setAttribute('viewBox', '0 0 ' + block.w + ' ' + block.h);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  }

  function render(svg, block, selected) {
    setup(svg, block);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const sel = selected || new Set();
    // highlighter underneath
    const order = (block.strokes || []).map((st, i) => [st, i]).sort((a, b) => (a[0].k === 'hl' ? 0 : 1) - (b[0].k === 'hl' ? 0 : 1));
    for (const [st, i] of order) {
      const p = pathEl(st);
      if (sel.has(i)) p.setAttribute('class', 'sel');
      svg.appendChild(p);
    }
    svg.parentElement && svg.parentElement.classList.toggle('empty', !(block.strokes || []).length);
  }

  function boundsOf(strokes) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const st of strokes) for (const q of st.p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    return { x0, y0, x1, y1 };
  }

  /** Light smoothing: moving average + drop near-duplicate points. Returns # strokes changed. */
  function smooth(block, only) {
    let n = 0;
    (block.strokes || []).forEach((st, idx) => {
      if (only && !only.has(idx)) return;
      if (st.p.length < 5 || st.g) return;
      const src = st.p, out = [src[0]];
      for (let i = 1; i < src.length - 1; i++) {
        let sx = 0, sy = 0, sp = 0, k = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(src.length - 1, i + 2); j++) { sx += src[j][0]; sy += src[j][1]; sp += src[j][2]; k++; }
        const q = [sx / k, sy / k, sp / k, src[i][3] || 0];
        const l = out[out.length - 1];
        if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.8) out.push(q);
      }
      out.push(src[src.length - 1]);
      st.p = out.map(q => [+q[0].toFixed(1), +q[1].toFixed(1), +q[2].toFixed(3), q[3] || 0]);
      n++;
    });
    return n;
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* -------- shape snapping: straight lines, triangles, rectangles, polygons, circles, ellipses -------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
  function resampleN(P, n) {
    const L = pathLen(P), step = L / (n - 1) || 1, out = [P[0]];
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      let a = P[i - 1];
      let d = dist(a, P[i]);
      while (acc + d >= step && d > 0) {
        const t = (step - acc) / d;
        a = [a[0] + t * (P[i][0] - a[0]), a[1] + t * (P[i][1] - a[1])];
        out.push(a);
        d = dist(a, P[i]); acc = 0;
      }
      acc += d;
    }
    while (out.length < n) out.push(P[P.length - 1]);
    return out.slice(0, n);
  }
  function rdp(P, eps) {
    if (P.length < 3) return P.slice();
    let idx = -1, max = 0;
    for (let i = 1; i < P.length - 1; i++) { const d = segDist(P[i], P[0], P[P.length - 1]); if (d > max) { max = d; idx = i; } }
    if (max <= eps) return [P[0], P[P.length - 1]];
    const l = rdp(P.slice(0, idx + 1), eps), r = rdp(P.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  function snapAngle(a, b) {
    // nudge near-horizontal / vertical / 45° lines onto the exact angle
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = dist(a, b);
    const step = Math.PI / 4, k = Math.round(ang / step), tol = 6 * Math.PI / 180;
    if (Math.abs(ang - k * step) < tol) return [a[0] + L * Math.cos(k * step), a[1] + L * Math.sin(k * step)];
    return b;
  }
  function densify(V, closed) {
    const out = [];
    const n = closed ? V.length : V.length - 1;
    for (let i = 0; i < n; i++) {
      const a = V[i], b = V[(i + 1) % V.length], steps = Math.max(1, Math.ceil(dist(a, b) / 3));
      for (let k = 0; k < steps; k++) out.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
    }
    out.push(closed ? V[0] : V[V.length - 1]);
    return out.map(q => [+q[0].toFixed(1), +q[1].toFixed(1), 0.5, 0]);
  }
  function polyResidual(P, V) {
    let s = 0;
    for (const p of P) { let m = 1e9; for (let i = 0; i < V.length; i++) m = Math.min(m, segDist(p, V[i], V[(i + 1) % V.length])); s += m; }
    return s / P.length;
  }
  function mergeStraight(V) {
    // drop vertices where the outline barely turns (sloppy corners)
    let changed = true;
    while (changed && V.length > 3) {
      changed = false;
      for (let i = 0; i < V.length; i++) {
        const a = V[(i - 1 + V.length) % V.length], b = V[i], c = V[(i + 1) % V.length];
        const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
        const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
        if (cos < -0.93 || dist(a, b) < 0.08 * (dist(a, c) || 1)) { V.splice(i, 1); changed = true; break; }
      }
    }
    return V;
  }

  /**
   * Try to turn a hand-drawn stroke into a clean shape.
   * forced = the pen was held still at the end (be generous); otherwise only confident, larger shapes snap.
   * Returns {p, g} (g: 1 open, 2 closed) or null.
   */
  function snapShape(raw, forced) {
    if (raw.length < 4) return null;
    const P0 = raw.map(q => [q[0], q[1]]);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of P0) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const diag = Math.hypot(x1 - x0, y1 - y0);
    if (diag < (forced ? 14 : 70)) return null;
    const L = pathLen(P0);
    const a = P0[0], b = P0[P0.length - 1];
    // straight line
    let dev = 0;
    for (const p of P0) dev = Math.max(dev, segDist(p, a, b));
    if (dist(a, b) > 0.88 * L && dev < Math.max(forced ? 6 : 4, (forced ? 0.08 : 0.045) * dist(a, b))) {
      return { p: densify([a, snapAngle(a, b)], false), g: 1 };
    }
    const P = resampleN(P0, 72);
    const closed = dist(a, b) < Math.max(14, 0.2 * diag);
    if (closed) {
      // polygon candidate
      let V = rdp(P, 0.075 * diag).slice(0, -1);
      V = mergeStraight(V);
      const polyErr = V.length >= 3 ? polyResidual(P, V) / diag : 1;
      // ellipse candidate (principal axes)
      const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of P) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      sxx /= P.length; syy /= P.length; sxy /= P.length;
      let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const cos = Math.cos(th), sin = Math.sin(th);
      let su = 0, sv = 0;
      for (const p of P) { const u = (p[0] - cx) * cos + (p[1] - cy) * sin, v = -(p[0] - cx) * sin + (p[1] - cy) * cos; su += u * u; sv += v * v; }
      let ea = Math.sqrt(2 * su / P.length), eb = Math.sqrt(2 * sv / P.length);
      let er = 0;
      for (const p of P) {
        const u = (p[0] - cx) * cos + (p[1] - cy) * sin, v = -(p[0] - cx) * sin + (p[1] - cy) * cos;
        er += Math.abs(Math.sqrt((u / (ea || 1)) ** 2 + (v / (eb || 1)) ** 2) - 1);
      }
      er /= P.length;
      const polyOK = V.length >= 3 && V.length <= 6 && polyErr < (forced ? 0.045 : 0.03);
      const ellOK = er < (forced ? 0.11 : 0.075) && V.length >= 4;
      if (polyOK && (!ellOK || V.length <= 4 && polyErr < er * 0.35)) {
        if (V.length === 4) {
          // rectangle if the corners are near 90°; axis-aligned if the sides are near level
          const right = V.every((q, i) => {
            const p0 = V[(i + 3) % 4], p2 = V[(i + 1) % 4];
            const v1 = [p0[0] - q[0], p0[1] - q[1]], v2 = [p2[0] - q[0], p2[1] - q[1]];
            return Math.abs((v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1)) < 0.22;
          });
          if (right) {
            const ang = Math.atan2(V[1][1] - V[0][1], V[1][0] - V[0][0]);
            const level = Math.abs(Math.sin(2 * ang)) < Math.sin(8 * Math.PI / 180);
            if (level) {
              let rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9;
              for (const q of V) { rx0 = Math.min(rx0, q[0]); ry0 = Math.min(ry0, q[1]); rx1 = Math.max(rx1, q[0]); ry1 = Math.max(ry1, q[1]); }
              // use the middle of the drawn edges rather than the extremes
              const ix = (rx1 - rx0) * 0.03, iy = (ry1 - ry0) * 0.03;
              V = [[rx0 + ix, ry0 + iy], [rx1 - ix, ry0 + iy], [rx1 - ix, ry1 - iy], [rx0 + ix, ry1 - iy]];
            }
          }
        }
        return { p: densify(V, true), g: 2 };
      }
      if (ellOK) {
        if (Math.min(ea, eb) / Math.max(ea, eb) > 0.88) { ea = eb = (ea + eb) / 2; th = 0; }
        const tilt = Math.abs(Math.sin(2 * th)) < Math.sin(8 * Math.PI / 180);
        if (tilt) th = Math.round(th / (Math.PI / 2)) * (Math.PI / 2);
        const c2 = Math.cos(th), s2 = Math.sin(th), out = [];
        const n = Math.max(36, Math.ceil(Math.PI * (ea + eb) / 3));
        for (let i = 0; i <= n; i++) {
          const t = 2 * Math.PI * i / n, u = ea * Math.cos(t), v = eb * Math.sin(t);
          out.push([+(cx + u * c2 - v * s2).toFixed(1), +(cy + u * s2 + v * c2).toFixed(1), 0.5, 0]);
        }
        return { p: out, g: 2 };
      }
      return null;
    }
    if (forced) {
      // open polyline: an angle, a zig-zag, an arrow shaft…
      const V = rdp(P, 0.06 * diag);
      if (V.length >= 2 && V.length <= 4) {
        let err = 0;
        for (const p of P) { let m = 1e9; for (let i = 0; i < V.length - 1; i++) m = Math.min(m, segDist(p, V[i], V[i + 1])); err += m; }
        if (err / P.length / diag < 0.035) return { p: densify(V, false), g: 1 };
      }
    }
    return null;
  }

  /* -------- eraser: removes only what is under it (or whole strokes in 'stroke' mode) -------- */
  const bbCache = new WeakMap();
  function sbox(st) {
    let b = bbCache.get(st);
    if (!b) {
      b = [1e9, 1e9, -1e9, -1e9];
      for (const q of st.p) { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1]; }
      bbCache.set(st, b);
    }
    return b;
  }
  function densePts(P, step) {
    const out = [P[0]];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor(d / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + ((b[2] || a[2]) - a[2]) * t, a[3] || 0]);
      }
      out.push(b);
    }
    return out;
  }
  /** Erase a disc of radius r at (x,y). Returns the new stroke list, or null if nothing changed. */
  function eraseDisc(strokes, x, y, r, mode) {
    let changed = false;
    const out = [];
    for (const st of strokes) {
      const rr = r + widthOf(st) / 2;
      const b = sbox(st);
      if (x < b[0] - rr || x > b[2] + rr || y < b[1] - rr || y > b[3] + rr) { out.push(st); continue; }
      if (mode === 'stroke') {
        if (densePts(st.p, Math.max(1, rr / 2)).some(q => Math.hypot(q[0] - x, q[1] - y) < rr)) { changed = true; continue; }
        out.push(st); continue;
      }
      const P = densePts(st.p, Math.max(0.8, rr / 3));
      const pieces = [];
      let run = [], hit = false;
      for (const q of P) {
        if (Math.hypot(q[0] - x, q[1] - y) < rr) { hit = true; if (run.length) { pieces.push(run); run = []; } }
        else run.push(q);
      }
      if (run.length) pieces.push(run);
      if (!hit) { out.push(st); continue; }
      // a closed outline cut once is still one piece: join the tail onto the head
      if (st.g === 2 && pieces.length >= 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 4 &&
          pieces[0][0] === P[0] && pieces[pieces.length - 1][pieces[pieces.length - 1].length - 1] === P[P.length - 1]) {
        pieces[0] = pieces.pop().concat(pieces[0]);
      }
      changed = true;
      for (const pc of pieces) {
        if (pc.length < 2) continue;
        const ns = Object.assign({}, st, { p: pc.map(q => [+q[0].toFixed(1), +q[1].toFixed(1), +(q[2] || 0.5).toFixed(3), q[3] || 0]) });
        if (st.g === 2) ns.g = 1;
        out.push(ns);
      }
    }
    return changed ? out : null;
  }
  /** Erase along the path from (x0,y0) to (x1,y1) so fast moves don't skip. */
  function eraseAlong(holder, x0, y0, x1, y1, r, mode) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / Math.max(2, r / 2)));
    let changed = false;
    for (let k = 1; k <= n; k++) {
      const res = eraseDisc(holder.strokes, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, mode);
      if (res) { holder.strokes = res; changed = true; }
    }
    return changed;
  }

  /* -------- momentum scrolling (used by the app's gesture handler) -------- */
  let flingRaf = 0;
  function fling(scroller, vx, vy) {
    cancelAnimationFrame(flingRaf);
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      scroller.scrollTop -= vy * dt;
      scroller.scrollLeft -= vx * dt;
      const k = Math.pow(0.995, dt);
      vx *= k; vy *= k;
      if (Math.abs(vx) + Math.abs(vy) > 0.03) flingRaf = requestAnimationFrame(step);
    };
    flingRaf = requestAnimationFrame(step);
  }
  const stopFling = () => cancelAnimationFrame(flingRaf);

  /**
   * A drawing session on one ink area. The app's central gesture handler feeds it pointer events.
   * opts: {onChange(), onSelect(indices[]), maxH() -> logical height limit}
   */
  function session(svg, block, opts) {
    setup(svg, block);
    let cur = null, curPath = null, mode = null, t0 = 0, lasso = null, lassoEl = null;
    let holdTimer = 0, lastMove = null, snapped = null;
    const HOLD_MS = 450;
    function armHold() {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (!cur || cur.k === 'hl' && false) return;
        const s = snapShape(cur.p, true);
        if (!s) return;
        snapped = s;
        const preview = Object.assign({}, cur, { p: s.p, g: s.g });
        const el = pathEl(preview);
        curPath.replaceWith(el);
        curPath = el;
      }, HOLD_MS);
    }

    const toLocal = (e) => {
      const r = svg.getBoundingClientRect();
      const k = block.w / r.width;
      return [+((e.clientX - r.left) * k).toFixed(1), +((e.clientY - r.top) * k).toFixed(1)];
    };
    const pressureOf = (e) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

    let lastErase = null;
    function eraseAt(x, y) {
      const p0 = lastErase || [x, y];
      lastErase = [x, y];
      if (eraseAlong(block, p0[0], p0[1], x, y, tool.eraserSize, tool.eraserMode)) { scheduleRender(); erased = true; }
    }
    let erased = false, rq = 0;
    function scheduleRender() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; render(svg, block); }); }

    function start(e) {
      const A = window.Android;
      const sideButton = e.pointerType === 'pen' && ((e.buttons & 2) === 2 || (e.buttons & 32) === 32 || e.button === 5 ||
        !!(A && A.penButton && A.penButton()));
      mode = sideButton || tool.kind === 'eraser' ? 'erase' : tool.kind === 'lasso' ? 'lasso' : 'draw';
      const [x, y] = toLocal(e);
      t0 = e.timeStamp;
      lastErase = null; erased = false;
      if (mode === 'erase') { eraseAt(x, y); return; }
      if (mode === 'lasso') {
        lasso = [[x, y]];
        lassoEl = document.createElementNS(NS, 'polyline');
        lassoEl.setAttribute('class', 'lasso');
        svg.appendChild(lassoEl);
        return;
      }
      const k = tool.kind === 'pencil' ? 'pc' : tool.kind === 'hl' ? 'hl' : '';
      cur = { c: tool.color, s: tool.size, p: [[x, y, pressureOf(e), 0]] };
      if (k) cur.k = k;
      if (tool.dash) cur.d = tool.dash;
      snapped = null; lastMove = [x, y];
      armHold();
      curPath = pathEl(cur);
      svg.appendChild(curPath);
      svg.parentElement.classList.remove('empty');
    }

    function move(e) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (snapped) return;                      // shape locked in: wait for the pen to lift
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = toLocal(ev);
        if (mode === 'erase') { eraseAt(x, y); continue; }
        if (mode === 'lasso') { lasso.push([x, y]); continue; }
        if (!cur) continue;
        if (lastMove && Math.hypot(x - lastMove[0], y - lastMove[1]) > 3) { lastMove = [x, y]; armHold(); }
        // side button pressed just after touching down: switch this stroke to erasing
        if (cur.p.length < 6 && ev.pointerType === 'pen' && ((ev.buttons & 2) === 2 || (window.Android && Android.penButton && Android.penButton()))) {
          if (curPath) curPath.remove();
          cur = null; curPath = null; mode = 'erase';
          eraseAt(x, y);
          continue;
        }
        const l = cur.p[cur.p.length - 1];
        if (Math.hypot(x - l[0], y - l[1]) < 0.6) continue;
        const maxH = opts.maxH ? opts.maxH() : 1e9;
        cur.p.push([x, Math.min(y, maxH - 2), +pressureOf(ev).toFixed(3), Math.round(ev.timeStamp - t0)]);
      }
      if (mode === 'lasso' && lassoEl) lassoEl.setAttribute('points', lasso.map(q => q.join(',')).join(' '));
      if (cur) {
        curPath.setAttribute('d', strokePath(cur));
        const maxY = cur.p[cur.p.length - 1][1];
        const maxH = opts.maxH ? opts.maxH() : 1e9;
        if (maxY > block.h - 50 && block.h < maxH) { block.h = Math.min(maxH, Math.ceil(maxY + 160)); setup(svg, block); }
      }
    }

    function end() {
      if (mode === 'erase') {
        mode = null; lastErase = null;
        if (erased) { erased = false; opts.onChange && opts.onChange(); }
        return;
      }
      if (mode === 'lasso') {
        if (lassoEl) lassoEl.remove();
        const sel = [];
        if (lasso && lasso.length > 4) {
          block.strokes.forEach((st, i) => {
            const inside = st.p.filter(q => pointInPoly(q[0], q[1], lasso)).length;
            if (inside >= 0.6 * st.p.length) sel.push(i);
          });
        }
        const poly = lasso;
        lasso = null; lassoEl = null;
        mode = null;
        opts.onSelect && opts.onSelect(sel, poly || []);
        return;
      }
      clearTimeout(holdTimer);
      if (cur) {
        if (cur.p.length === 1) cur.p.push([cur.p[0][0] + 0.5, cur.p[0][1] + 0.5, cur.p[0][2], 1]);
        const s = snapped || (tool.shapes && cur.k !== 'hl' ? snapShape(cur.p, false) : null);
        if (s) { cur.p = s.p; cur.g = s.g; }
        block.strokes.push(cur);
        const el = pathEl(cur);
        curPath.replaceWith(el);
        cur = null; curPath = null; snapped = null;
        mode = null;
        opts.onChange && opts.onChange();
      }
      mode = null;
    }

    /** Erase under a screen point (used for the S Pen side button, handled natively). Returns true if something went. */
    function eraseClient(cx, cy, first) {
      const [x, y] = toLocal({ clientX: cx, clientY: cy });
      if (first) lastErase = null;
      const p0 = lastErase || [x, y];
      lastErase = [x, y];
      if (eraseAlong(block, p0[0], p0[1], x, y, tool.eraserSize, tool.eraserMode)) { scheduleRender(); return true; }
      return false;
    }

    function cancel() {
      clearTimeout(holdTimer); snapped = null;
      if (curPath) curPath.remove();
      if (lassoEl) lassoEl.remove();
      cur = null; curPath = null; lasso = null; lassoEl = null; mode = null;
      svg.parentElement && svg.parentElement.classList.toggle('empty', !block.strokes.length);
    }

    svg.addEventListener('contextmenu', ev => ev.preventDefault());
    return { start, move, end, cancel, eraseClient, svg, block, get active() { return !!mode; } };
  }

  window.Ink = { render, session, smooth, setup, boundsOf, tool, fling, stopFling, snapShape, eraseDisc, pointInPoly, W };
})();
