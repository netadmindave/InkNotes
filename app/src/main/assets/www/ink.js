/* ink.js — S Pen handwriting areas, stored as vector strokes.
 * Pen draws; finger scrolls (with momentum) or taps. Tools: pen, pencil, highlighter, eraser, lasso.
 * Stroke: {c: colour, s: size, k: kind ('' | 'pc' | 'hl'), p: [[x, y, pressure, t], ...]}
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 900; // logical width of every ink area

  const tool = { kind: 'pen', color: '#1d3557', size: 4, penOnly: true };

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
    if (st.k === 'hl') o = { size: st.s * 4.5, thinning: 0, smoothing: 0.7, streamline: 0.6, simulatePressure: false };
    else if (st.k === 'pc') o = { size: st.s * 1.4, thinning: 0.35, smoothing: 0.5, streamline: 0.4, simulatePressure: !hasPressure };
    else o = { size: st.s * 2.2, thinning: 0.6, smoothing: 0.6, streamline: 0.45, simulatePressure: !hasPressure,
      start: { taper: hasPressure ? 0 : 6, cap: true }, end: { taper: hasPressure ? 0 : 10, cap: true } };
    o.last = true;
    return pathFromOutline(PF.getStroke(st.p.map(q => [q[0], q[1], q[2]]), o));
  }

  function pathEl(st) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', strokePath(st));
    p.setAttribute('fill', st.c);
    if (st.k === 'hl') p.setAttribute('fill-opacity', '0.32');
    if (st.k === 'pc') p.setAttribute('fill-opacity', '0.82');
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
    if (sel.size) {
      const b = boundsOf(block.strokes.filter((_, i) => sel.has(i)));
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', b.x0 - 8); r.setAttribute('y', b.y0 - 8);
      r.setAttribute('width', b.x1 - b.x0 + 16); r.setAttribute('height', b.y1 - b.y0 + 16);
      r.setAttribute('class', 'selbox'); r.setAttribute('rx', 6);
      svg.appendChild(r);
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
      if (st.p.length < 5) return;
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

  /* -------- finger scrolling with momentum -------- */
  let flingRaf = 0;
  function fling(scroller, v) {
    cancelAnimationFrame(flingRaf);
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      scroller.scrollTop -= v * dt;
      v *= Math.pow(0.995, dt);
      if (Math.abs(v) > 0.02) flingRaf = requestAnimationFrame(step);
    };
    flingRaf = requestAnimationFrame(step);
  }

  /**
   * Make an ink area live. opts: {scroller, onChange(), onTap(), onSelect(indices[]), selected() -> Set}
   * Returns {begin(e)} so a stroke started elsewhere (the page pad) can continue here.
   */
  function attach(svg, block, opts) {
    setup(svg, block);
    let cur = null, curPath = null, mode = null, activeId = null, t0 = 0;
    let finger = null, lasso = null, lassoEl = null;

    const toLocal = (e) => {
      const r = svg.getBoundingClientRect();
      const k = block.w / r.width;
      return [+((e.clientX - r.left) * k).toFixed(1), +((e.clientY - r.top) * k).toFixed(1)];
    };
    const pressureOf = (e) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

    function eraseAt(x, y) {
      const r = 12;
      const before = block.strokes.length;
      block.strokes = block.strokes.filter(st => !st.p.some(q => Math.hypot(q[0] - x, q[1] - y) < r + st.s));
      if (block.strokes.length !== before) { render(svg, block); opts.onChange && opts.onChange(); }
    }

    function begin(e) {
      activeId = e.pointerId;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { }
      const sideButton = (e.buttons & 2) === 2 || (e.buttons & 32) === 32 || e.button === 5;
      mode = sideButton || tool.kind === 'eraser' ? 'erase' : tool.kind === 'lasso' ? 'lasso' : 'draw';
      const [x, y] = toLocal(e);
      t0 = e.timeStamp;
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
      curPath = pathEl(cur);
      svg.appendChild(curPath);
      svg.parentElement.classList.remove('empty');
    }

    function down(e) {
      if (activeId !== null && e.pointerId !== activeId) return;
      if (e.pointerType === 'touch' && tool.penOnly || e.pointerType === 'touch' && tool.kind === 'scroll') {
        cancelAnimationFrame(flingRaf);
        finger = { id: e.pointerId, y: e.clientY, x: e.clientX, y0: e.clientY, x0: e.clientX, t: e.timeStamp, v: 0 };
        activeId = e.pointerId;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { }
        return;
      }
      e.preventDefault();
      begin(e);
    }

    function move(e) {
      if (e.pointerId !== activeId) return;
      if (finger) {
        const dy = e.clientY - finger.y, dt = Math.max(1, e.timeStamp - finger.t);
        opts.scroller.scrollTop -= dy;
        finger.v = 0.7 * finger.v + 0.3 * (dy / dt);
        finger.y = e.clientY; finger.t = e.timeStamp;
        return;
      }
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = toLocal(ev);
        if (mode === 'erase') { eraseAt(x, y); continue; }
        if (mode === 'lasso') { lasso.push([x, y]); continue; }
        if (!cur) continue;
        const l = cur.p[cur.p.length - 1];
        if (Math.hypot(x - l[0], y - l[1]) < 0.6) continue;
        cur.p.push([x, y, +pressureOf(ev).toFixed(3), Math.round(ev.timeStamp - t0)]);
      }
      if (mode === 'lasso' && lassoEl) lassoEl.setAttribute('points', lasso.map(q => q.join(',')).join(' '));
      if (cur) {
        curPath.setAttribute('d', strokePath(cur));
        const maxY = cur.p[cur.p.length - 1][1];
        if (maxY > block.h - 50) { block.h = Math.ceil(maxY + 160); setup(svg, block); }
      }
    }

    function up(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      if (finger) {
        const moved = Math.hypot(e.clientX - finger.x0, e.clientY - finger.y0);
        if (moved < 8 && e.type === 'pointerup') opts.onTap && opts.onTap(e);
        else if (Math.abs(finger.v) > 0.1) fling(opts.scroller, finger.v);
        finger = null;
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
        lasso = null; lassoEl = null;
        opts.onSelect && opts.onSelect(sel);
      } else if (cur) {
        if (cur.p.length === 1) cur.p.push([cur.p[0][0] + 0.5, cur.p[0][1] + 0.5, cur.p[0][2], 1]);
        block.strokes.push(cur);
        curPath.setAttribute('d', strokePath(cur));
        cur = null; curPath = null;
        opts.onChange && opts.onChange();
      }
      mode = null;
    }

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('contextmenu', ev => ev.preventDefault());
    return { begin };
  }

  window.Ink = { render, attach, smooth, setup, boundsOf, tool, fling, W };
})();
