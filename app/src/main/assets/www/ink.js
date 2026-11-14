/* ink.js — pressure-sensitive S Pen drawing areas, stored as vector strokes. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 900; // logical width of every ink area

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
    const outline = PF.getStroke(st.p, {
      size: st.s * 2.2, thinning: 0.6, smoothing: 0.6, streamline: 0.45,
      simulatePressure: !hasPressure, last: true,
      start: { taper: hasPressure ? 0 : 6, cap: true }, end: { taper: hasPressure ? 0 : 10, cap: true }
    });
    return pathFromOutline(outline);
  }

  function setup(svg, block) {
    if (!block.w) block.w = W;
    if (!block.h) block.h = 260;
    svg.setAttribute('viewBox', '0 0 ' + block.w + ' ' + block.h);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  }

  function render(svg, block) {
    setup(svg, block);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const st of block.strokes || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', strokePath(st));
      p.setAttribute('fill', st.c);
      svg.appendChild(p);
    }
    svg.parentElement && svg.parentElement.classList.toggle('empty', !(block.strokes || []).length);
  }

  /** Light smoothing: moving average + drop near-duplicate points. Returns # strokes changed. */
  function smooth(block) {
    let n = 0;
    for (const st of block.strokes || []) {
      if (st.p.length < 5) continue;
      const src = st.p, out = [src[0]];
      for (let i = 1; i < src.length - 1; i++) {
        let sx = 0, sy = 0, sp = 0, k = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(src.length - 1, i + 2); j++) { sx += src[j][0]; sy += src[j][1]; sp += src[j][2]; k++; }
        const q = [sx / k, sy / k, sp / k];
        const l = out[out.length - 1];
        if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.8) out.push(q);
      }
      out.push(src[src.length - 1]);
      st.p = out.map(q => [+q[0].toFixed(1), +q[1].toFixed(1), +q[2].toFixed(3)]);
      n++;
    }
    return n;
  }

  /**
   * Make an ink area editable. opts: {color(), size(), tool(), penOnly(), scroller, onChange(), onPenSeen()}
   * Returns a detach function.
   */
  function attach(svg, block, opts) {
    setup(svg, block);
    let cur = null, curPath = null, erasing = false, fingerY = null, activeId = null;

    const toLocal = (e) => {
      const r = svg.getBoundingClientRect();
      const k = block.w / r.width;
      return [+((e.clientX - r.left) * k).toFixed(1), +((e.clientY - r.top) * k).toFixed(1)];
    };
    const pressureOf = (e) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

    function eraseAt(x, y) {
      const r = 14;
      const before = block.strokes.length;
      block.strokes = block.strokes.filter(st => !st.p.some(q => Math.hypot(q[0] - x, q[1] - y) < r + st.s));
      if (block.strokes.length !== before) { render(svg, block); opts.onChange && opts.onChange(true); }
    }

    function down(e) {
      if (activeId !== null && e.pointerId !== activeId) return;
      if (e.pointerType === 'pen') opts.onPenSeen && opts.onPenSeen();
      if (e.pointerType === 'touch' && opts.penOnly()) {
        fingerY = e.clientY; activeId = e.pointerId;
        svg.setPointerCapture(e.pointerId);
        return;
      }
      e.preventDefault();
      activeId = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      // S Pen side button (secondary) or eraser end => erase
      erasing = opts.tool() === 'eraser' || (e.buttons & 2) === 2 || (e.buttons & 32) === 32 || e.button === 5;
      const [x, y] = toLocal(e);
      if (erasing) { eraseAt(x, y); return; }
      cur = { c: opts.color(), s: opts.size(), p: [[x, y, pressureOf(e)]] };
      curPath = document.createElementNS(NS, 'path');
      curPath.setAttribute('fill', cur.c);
      svg.appendChild(curPath);
      svg.parentElement.classList.remove('empty');
    }

    function move(e) {
      if (e.pointerId !== activeId) return;
      if (fingerY !== null) {
        opts.scroller.scrollTop -= (e.clientY - fingerY);
        fingerY = e.clientY;
        return;
      }
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = toLocal(ev);
        if (erasing) { eraseAt(x, y); continue; }
        if (!cur) continue;
        const l = cur.p[cur.p.length - 1];
        if (Math.hypot(x - l[0], y - l[1]) < 0.6) continue;
        cur.p.push([x, y, +pressureOf(ev).toFixed(3)]);
      }
      if (cur) {
        curPath.setAttribute('d', strokePath(cur));
        // grow the area when writing near the bottom
        const maxY = cur.p[cur.p.length - 1][1];
        if (maxY > block.h - 40) { block.h = Math.ceil(maxY + 120); setup(svg, block); }
      }
    }

    function up(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      if (fingerY !== null) { fingerY = null; return; }
      if (cur) {
        if (cur.p.length === 1) cur.p.push([cur.p[0][0] + 0.5, cur.p[0][1] + 0.5, cur.p[0][2]]);
        block.strokes.push(cur);
        curPath.setAttribute('d', strokePath(cur));
        cur = null; curPath = null;
        opts.onChange && opts.onChange(true);
      }
      erasing = false;
    }

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('contextmenu', ev => ev.preventDefault());
    return function detach() {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    };
  }

  window.Ink = { render, attach, smooth, setup, W };
})();
