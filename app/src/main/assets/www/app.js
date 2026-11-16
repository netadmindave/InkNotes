/* app.js — InkNotes UI controller */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const A = window.Android;

  /* ---------------- storage ---------------- */
  const store = A ? {
    ids: () => { try { return JSON.parse(A.listNotes()); } catch (e) { return []; } },
    load: (id) => A.load(id),
    save: (id, json) => A.save(id, json),
    remove: (id) => A.remove(id),
    getPref: (k) => A.getPref(k),
    setPref: (k, v) => A.setPref(k, v),
    readAsset: (p) => A.readAsset(p)
  } : {
    ids: () => Object.keys(localStorage).filter(k => k.startsWith('note:')).map(k => k.slice(5)),
    load: (id) => localStorage.getItem('note:' + id) || '',
    save: (id, json) => { localStorage.setItem('note:' + id, json); return true; },
    remove: (id) => localStorage.removeItem('note:' + id),
    getPref: (k) => localStorage.getItem('pref:' + k) || '',
    setPref: (k, v) => localStorage.setItem('pref:' + k, v),
    readAsset: (p) => { const x = new XMLHttpRequest(); x.open('GET', p.replace(/^www\//, ''), false); x.send(); return x.responseText; }
  };

  const toast = (m) => A ? A.toast(m) : console.log('[toast]', m);

  /* ---------------- prefs ---------------- */
  const prefs = {
    font: store.getPref('font') || 'caveat',
    paper: store.getPref('paper') || 'lined',
    handMath: store.getPref('handMath') !== '0',
    autoMath: store.getPref('autoMath') !== '0',
    size: store.getPref('size') || 'letter',
    // no S Pen (e.g. Pixel) → one finger writes; with a pen, fingers scroll by default
    fingerDraws: (() => { const v = store.getPref('fingerDraws'); if (v) return v === '1'; try { return !(A && A.hasStylus && A.hasStylus()); } catch (e) { return true; } })(),
    lock: store.getPref('lock') === '1',
    textSize: store.getPref('textSize') || 'm',
    dash: store.getPref('dash') || '',
    shapes: store.getPref('shapes') !== '0',
    eraserSize: parseFloat(store.getPref('eraserSize') || '10'),
    eraserMode: store.getPref('eraserMode') || 'area',
    mode: store.getPref('mode') || 'text',
    inkColor: store.getPref('inkColor') || '#1d3557',
    inkSize: parseFloat(store.getPref('inkSize2') || '2.5'),
    lastNote: store.getPref('lastNote') || ''
  };
  let userDict = new Set();
  try { userDict = new Set(JSON.parse(store.getPref('userDict') || '[]')); } catch (e) { }
  const setPref = (k, v) => { prefs[k] = v; store.setPref(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); };

  const FONTS = [['caveat', 'Caveat', 'Caveat'], ['kalam', 'Kalam', 'Kalam'], ['patrick', 'Patrick Hand', 'Patrick'], ['shadows', 'Shadows Into Light', 'Shadows']];
  const PAPERS = [['lined', 'Lined'], ['grid', 'Grid'], ['dot', 'Dots'], ['plain', 'Plain']];
  const INK_COLORS = ['#1d3557', '#111111', '#c2410c', '#2f7d32', '#7b2cbf', '#f5c518'];
  const SIZES = { letter: { w: 816, h: 1056, label: 'Letter 8.5×11', css: '8.5in 11in' }, a4: { w: 794, h: 1123, label: 'A4', css: '210mm 297mm' } };
  const LINE = { s: 28, m: 32, l: 40 };
  const lineH = () => LINE[prefs.textSize] || 32;
  const MARGIN = { get t() { return 2 * lineH(); }, b: 56, l: 96, r: 56 };
  const pageDim = () => SIZES[(note && note.size) || prefs.size] || SIZES.letter;
  const contentW = () => pageDim().w - MARGIN.l - MARGIN.r;
  const contentH = () => pageDim().h - MARGIN.t - MARGIN.b;

  function applyBodyClasses() {
    document.body.classList.remove(...FONTS.map(f => 'font-' + f[0]));
    document.body.classList.add('font-' + prefs.font);
    document.body.classList.toggle('handmath', prefs.handMath);
    document.body.classList.remove('ts-s', 'ts-m', 'ts-l');
    document.body.classList.add('ts-' + prefs.textSize);
  }

  /* ---------------- notes ---------------- */
  let index = [];        // [{id,title,updated,preview,text}]
  let note = null;       // current note object
  const uid = (p) => (p || 'b') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function previewOf(n) {
    const items = n.pages ? n.pages.flatMap(p => p.items.slice().sort((a, b) => a.y - b.y || a.x - b.x)) : (n.blocks || []);
    const t = items.map(b => b.type === 'text' || b.type === 'math' ? b.src : '').join(' ').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function loadIndex() {
    index = [];
    for (const id of store.ids()) {
      try {
        const n = JSON.parse(store.load(id));
        index.push({ id, title: n.title || 'Untitled', updated: n.updated || 0, preview: previewOf(n), text: ((n.title || '') + ' ' + previewOf(n)).toLowerCase() });
      } catch (e) { }
    }
    index.sort((a, b) => b.updated - a.updated);
  }

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const ul = $('#noteList');
    ul.innerHTML = '';
    for (const it of index) {
      if (q && !it.text.includes(q)) continue;
      const li = document.createElement('li');
      if (note && it.id === note.id) li.className = 'on';
      li.innerHTML = '<div class="t"></div><div class="s"></div>';
      li.firstChild.textContent = it.title || 'Untitled';
      li.lastChild.textContent = fmtDate(it.updated) + (it.preview ? ' · ' + it.preview : '');
      li.onclick = () => { openNote(it.id); document.body.classList.remove('drawer'); };
      ul.appendChild(li);
    }
  }

  function fmtDate(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!note) return;
    note.updated = Date.now();
    store.save(note.id, JSON.stringify(note));
    const it = index.find(i => i.id === note.id);
    const entry = { id: note.id, title: note.title || 'Untitled', updated: note.updated, preview: previewOf(note) };
    entry.text = (entry.title + ' ' + entry.preview).toLowerCase();
    if (it) Object.assign(it, entry); else index.unshift(entry);
    index.sort((a, b) => b.updated - a.updated);
    renderList();
    $('#meta').textContent = 'Edited ' + fmtDate(note.updated);
  }

  function newNote(pages, title) {
    finishEdit();
    sel = null;
    if (note) saveNow();
    note = { id: uid('n'), title: title || '', created: Date.now(), updated: Date.now(), paper: prefs.paper, size: prefs.size, pages: pages || [newPageObj()] };
    store.save(note.id, JSON.stringify(note));
    loadIndex();
    showNote();
    return note;
  }

  function openNote(id) {
    finishEdit();
    if (note) saveNow();
    try { note = JSON.parse(store.load(id)); } catch (e) { note = null; }
    if (!note) return;
    note.id = id;
    note.size = note.size || 'letter';
    migrate(note);
    if (!note.pages.length) note.pages.push(newPageObj());
    sel = null;
    showNote();
  }

  function showNote() {
    setPref('lastNote', note.id);
    $('#title').value = note.title || '';
    $('#meta').textContent = note.updated ? 'Edited ' + fmtDate(note.updated) : '';
    history = [snapshot()]; hIdx = 0; updateUndo();
    userZoom = 1;
    applyZoom();
    render();
    renderList();
    $('#scroller').scrollTop = 0;
  }

  /* ---------------- undo / redo ---------------- */
  let history = [], hIdx = 0;
  const snapshot = () => JSON.stringify({ title: note.title, pages: note.pages, paper: note.paper, size: note.size });
  function commit() {
    if (!note) return;
    const s = snapshot();
    if (history[hIdx] === s) return;
    history = history.slice(0, hIdx + 1);
    history.push(s);
    if (history.length > 50) history.shift();
    hIdx = history.length - 1;
    updateUndo();
    scheduleSave();
  }
  function restore(s) {
    const o = JSON.parse(s);
    note.title = o.title; note.pages = o.pages; note.paper = o.paper; note.size = o.size || note.size;
    $('#title').value = note.title || '';
    sel = null;
    applyZoom();
    render();
    scheduleSave();
    updateUndo();
  }
  function undo() { finishEdit(); sel = null; if (hIdx > 0) restore(history[--hIdx]); }
  function redo() { finishEdit(); sel = null; if (hIdx < history.length - 1) restore(history[++hIdx]); }
  function updateUndo() { $('#btnUndo').disabled = hIdx <= 0; $('#btnRedo').disabled = hIdx >= history.length - 1; }

  /* ---------------- pages: one free canvas per sheet ----------------
   * note.pages = [{ id, w, h, strokes: [...], items: [{ id, type: 'text'|'math', x, y, w, src }] }]
   * Everything is in page pixels (Letter 816×1056, A4 794×1123). The ink layer covers the whole
   * sheet, so the pen writes anywhere — over text too. Typed and converted text sits where it was put,
   * without boxes. A tap on text edits it; a stroke over it is ink.
   */
  const pagesEl = $('#pages');
  const SVGNS = 'http://www.w3.org/2000/svg';
  let editing = null;   // {pi, item, el, ta}
  let sel = null;       // {pi, strokes:Set<index>, items:Set<id>}
  let lastPi = 0;

  const sheetEl = (pi) => pagesEl.querySelector('.sheet[data-pi="' + pi + '"]');
  const newPageObj = () => ({ id: uid('p'), strokes: [], items: [] });
  function findItem(id) {
    for (let pi = 0; pi < note.pages.length; pi++) {
      const item = note.pages[pi].items.find(i => i.id === id);
      if (item) return { pi, item };
    }
    return null;
  }
  /** screen point → page pixels on sheet pi */
  function toPage(pi, cx, cy) {
    const r = sheetEl(pi).getBoundingClientRect(), k = pageDim().w / r.width;
    return [(cx - r.left) * k, (cy - r.top) * k];
  }
  const screenScale = () => { const sh = sheetEl(0); return sh ? sh.getBoundingClientRect().width / pageDim().w : curZoom; };

  /** Notes from before pages were free canvases (a stack of blocks): lay them out once. */
  function migrate(n) {
    if (n.pages) return;
    const d = SIZES[n.size || 'letter'] || SIZES.letter, L = 32, top = 2 * L, cw = d.w - MARGIN.l - MARGIN.r, bottom = d.h - MARGIN.b;
    const pages = [newPageObj()];
    let pg = pages[0], y = top + 3 * L;
    const next = () => { pg = newPageObj(); pages.push(pg); y = top; };
    for (const b of n.blocks || []) {
      if (b.type === 'break') { next(); continue; }
      let h;
      if (b.type === 'text') h = (b.src || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / 60)), 0) * L;
      else if (b.type === 'math') h = 3 * L;
      else h = (b.h || 200) * cw / (b.w || cw);
      if (y + h > bottom && y > top + 10) next();
      if (b.type === 'ink') {
        const k = cw / (b.w || cw);
        for (const st of b.strokes || []) {
          pg.strokes.push(Object.assign({}, st, { s: +(st.s * k).toFixed(2),
            p: st.p.map(q => [+(MARGIN.l + q[0] * k).toFixed(1), +(y + q[1] * k).toFixed(1), q[2], q[3] || 0]) }));
        }
      } else pg.items.push({ id: b.id || uid(), type: b.type, x: MARGIN.l, y, w: cw, src: b.src || '' });
      y += Math.ceil(h / L) * L;
    }
    n.pages = pages;
    delete n.blocks;
  }

  /* ---------- rendering ---------- */
  function render() {
    editing = null;
    hideBars();
    const header = $('#noteHead');
    const sc = $('#scroller'), keepTop = sc.scrollTop, keepLeft = sc.scrollLeft;
    pagesEl.innerHTML = '';
    $('#pageStyle').textContent = '@page { size: ' + pageDim().css + '; margin: 0; }';
    note.pages.forEach((pg, pi) => pagesEl.appendChild(buildSheet(pi, header)));
    const add = document.createElement('button');
    add.id = 'addPage'; add.className = 'pill'; add.textContent = '＋ Add page';
    add.onclick = () => addPage(true);
    pagesEl.appendChild(add);
    sc.scrollTop = keepTop; sc.scrollLeft = keepLeft;
  }

  function buildSheet(pi, header) {
    const pg = note.pages[pi], d = pageDim();
    pg.w = d.w; pg.h = d.h;
    const sh = document.createElement('div');
    sh.className = 'sheet paper-' + (note.paper || prefs.paper);
    sh.dataset.pi = pi;
    sh.style.width = d.w + 'px';
    sh.style.height = d.h + 'px';
    if (pi === 0 && header) sh.appendChild(header);
    const items = document.createElement('div');
    items.className = 'items';
    for (const it of pg.items) items.appendChild(itemEl(it, sel && sel.pi === pi && sel.items.has(it.id)));
    sh.appendChild(items);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'inklayer');
    sh.appendChild(svg);
    Ink.render(svg, pg, sel && sel.pi === pi ? sel.strokes : null);
    sh._svg = svg;
    sh._ink = Ink.session(svg, pg, {
      onChange: () => afterInk(pi),
      onSelect: (idx, poly) => lassoSelect(pi, idx, poly)
    });
    const num = document.createElement('div');
    num.className = 'pnum'; num.textContent = String(pi + 1);
    sh.appendChild(num);
    if (!pg.strokes.length && !pg.items.length && note.pages.length > 1) {
      const rm = document.createElement('button');
      rm.className = 'pill rmpage'; rm.textContent = 'Remove blank page';
      rm.onclick = () => { note.pages.splice(pi, 1); sel = null; render(); commit(); };
      sh.appendChild(rm);
    }
    if (sel && sel.pi === pi) requestAnimationFrame(() => drawSelection(pi));
    return sh;
  }

  function renderPage(pi) {
    const old = sheetEl(pi);
    if (!old) { render(); return; }
    if (editing && editing.pi === pi) editing = null;
    old.replaceWith(buildSheet(pi, pi === 0 ? $('#noteHead') : null));
  }

  function itemEl(it, picked) {
    const el = document.createElement('div');
    el.className = 'item ' + it.type + (picked ? ' picked' : '');
    el.dataset.id = it.id;
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    if (it.type === 'text') {
      el.style.width = it.w + 'px';
      const misspelt = Cleanup.ready ? Cleanup.misspeltWords(it.src, userDict, prefs.autoMath) : null;
      el.innerHTML = '<div class="hand">' + MathText.renderText(it.src, { autoMath: prefs.autoMath, misspelt }) + '</div>';
    } else {
      el.innerHTML = '<div class="disp">' + MathText.renderMath(it.src, true).html + '</div>';
    }
    return el;
  }

  /** Where the text of an item actually is (page px), not its full-width box. */
  function itemRect(pi, it) {
    const sh = sheetEl(pi), el = sh && sh.querySelector('.item[data-id="' + it.id + '"]');
    if (!el) return { x0: it.x, y0: it.y, x1: it.x + 100, y1: it.y + 30 };
    const rg = document.createRange();
    rg.selectNodeContents(el);
    let r = rg.getBoundingClientRect();
    if (!r.width) r = el.getBoundingClientRect();
    const [x0, y0] = toPage(pi, r.left, r.top), [x1, y1] = toPage(pi, r.right, r.bottom);
    return { x0, y0, x1, y1 };
  }

  function addPage(scroll) {
    finishEdit(); clearSel();
    note.pages.push(newPageObj());
    render();
    commit();
    if (scroll) { const sh = sheetEl(note.pages.length - 1); sh && sh.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  /* ---------- zoom ---------- */
  let userZoom = 1, curZoom = 1;
  function fitZoom() {
    const sc = $('#scroller');
    const avail = sc.clientWidth - (sc.clientWidth < 700 ? 8 : 40);
    return Math.max(0.2, Math.min(1.6, avail / pageDim().w));
  }
  function applyZoom() {
    curZoom = fitZoom() * userZoom;
    pagesEl.style.zoom = curZoom;
  }

  /* ---------- ink changes ---------- */
  function afterInk(pi) {
    lastPi = pi;
    if (sel && sel.pi === pi) { sel = null; renderPage(pi); }
    commit();
    // writing near the bottom of the last page opens a fresh one
    const pg = note.pages[pi];
    if (pi === note.pages.length - 1 && pg.strokes.some(st => st.p.some(q => q[1] > pageDim().h - MARGIN.b - 10))) {
      note.pages.push(newPageObj());
      const add = $('#addPage');
      pagesEl.insertBefore(buildSheet(note.pages.length - 1, null), add);
      commit();
    }
  }

  /* ---------- typing ---------- */
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  function typeAt(pi, x, y) {
    finishEdit(); clearSel();
    const L = lineH(), d = pageDim();
    let ix = x < MARGIN.l + 60 ? MARGIN.l : Math.round(x);
    ix = Math.max(8, Math.min(ix, d.w - MARGIN.r - 120));
    let iy = Math.floor(y / L) * L;
    if (pi === 0) iy = Math.max(iy, 4 * L);
    const it = { id: uid(), type: prefs.mode === 'math' ? 'math' : 'text', x: ix, y: iy, w: d.w - MARGIN.r - ix, src: '' };
    note.pages[pi].items.push(it);
    renderPage(pi);
    startEdit(it.id);
  }

  function itemBar(pi, item) {
    const a = document.createElement('div');
    a.className = 'itembar';
    const btn = (label, title, fn, cls) => {
      const x = document.createElement('button');
      x.textContent = label; x.title = title; if (cls) x.className = cls;
      x.addEventListener('pointerdown', e => { e.stopPropagation(); if (label !== '✥') e.preventDefault(); });
      if (fn) x.addEventListener('click', e => { e.stopPropagation(); fn(); });
      a.appendChild(x);
      return x;
    };
    const grip = btn('✥', 'Drag to move', null, 'grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const k = pageDim().w / sheetEl(pi).getBoundingClientRect().width;
      const sx = e.clientX, sy = e.clientY, ox = item.x, oy = item.y;
      const mv = (ev) => {
        item.x = Math.max(0, ox + (ev.clientX - sx) * k);
        item.y = Math.max(0, oy + (ev.clientY - sy) * k);
        editing.el.style.left = item.x + 'px'; editing.el.style.top = item.y + 'px';
      };
      const upH = () => {
        grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upH);
        const L = lineH();
        item.y = Math.round(item.y / L) * L;
        item.w = Math.max(120, pageDim().w - MARGIN.r - item.x);
        editing.el.style.top = item.y + 'px';
        if (item.type === 'text') editing.el.style.width = item.w + 'px';
        commit();
        editing.ta.focus();
      };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', upH);
    });
    btn(item.type === 'text' ? '→ ∑' : '→ Aa', 'Switch text / formula', () => { switchItemType(item.type === 'text' ? 'math' : 'text'); });
    btn('Delete', 'Delete', () => {
      const pg = note.pages[pi];
      pg.items = pg.items.filter(i => i !== item);
      editing = null; hideBars();
      renderPage(pi); commit();
    }, 'danger');
    return a;
  }

  function switchItemType(t) {
    if (!editing || editing.item.type === t) return;
    const id = editing.item.id;
    editing.item.type = t;
    const pi = editing.pi;
    editing = null; hideBars();
    renderPage(pi);
    startEdit(id);
  }

  function startEdit(id, opts) {
    opts = opts || {};
    if (editing && editing.item.id === id) return;
    finishEdit(); clearSel();
    const f = findItem(id);
    if (!f) return;
    const { pi, item } = f;
    const sh = sheetEl(pi);
    const old = sh && sh.querySelector('.item[data-id="' + id + '"]');
    if (!old) return;
    const el = document.createElement('div');
    el.className = 'item ' + item.type + ' editing';
    el.dataset.id = id;
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    if (item.type === 'text') el.style.width = item.w + 'px';
    el.appendChild(itemBar(pi, item));
    const ta = document.createElement('textarea');
    ta.value = item.src;
    ta.rows = 1;
    ta.spellcheck = item.type === 'text';
    ta.setAttribute('autocapitalize', item.type === 'text' ? 'sentences' : 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.placeholder = item.type === 'math' ? 'formula, e.g. int_0^oo e^(-x^2) dx' : 'Type…';
    let prev = null, err = null;
    if (item.type === 'math') {
      prev = document.createElement('div'); prev.className = 'disp';
      err = document.createElement('div'); err.className = 'err';
      el.appendChild(prev);
      ta.className = 'src';
    }
    el.appendChild(ta);
    if (err) el.appendChild(err);
    old.replaceWith(el);
    editing = { pi, item, el, ta };
    const update = () => {
      item.src = ta.value;
      autoGrow(ta);
      if (prev) {
        const r = MathText.renderMath(item.src, true);
        prev.innerHTML = item.src.trim() ? r.html : '';
        err.textContent = r.ok ? '' : r.err;
      }
      scheduleSave();
      if (editing) { clearTimeout(editing.commitTimer); editing.commitTimer = setTimeout(commit, 1500); }
    };
    ta.addEventListener('input', update);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (item.type === 'math' && e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); finishEdit(); }
    });
    update();
    ta.focus({ preventScroll: true });
    const pos = typeof opts.caret === 'number' ? opts.caret : ta.value.length;
    ta.setSelectionRange(pos, pos);
    requestAnimationFrame(() => autoGrow(ta));
    if (item.type === 'math') showMathbar();
    setModeUI(item.type);
  }

  function finishEdit() {
    if (!editing) return;
    const ed = editing;
    editing = null;
    clearTimeout(ed.commitTimer);
    hideBars();
    const pg = note.pages[ed.pi];
    if (pg) {
      if (!ed.item.src.trim()) pg.items = pg.items.filter(i => i !== ed.item);
      else if (ed.item.type === 'math') ed.item.src = ed.item.src.trim();
      renderPage(ed.pi);
    }
    commit();
    setModeUI(prefs.mode);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function toggleCheck(pi, item, lineIdx) {
    const lines = item.src.split('\n');
    lines[lineIdx] = lines[lineIdx].replace(/\[( |x|X)\]/, (m, c) => c === ' ' ? '[x]' : '[ ]');
    item.src = lines.join('\n');
    renderPage(pi);
    commit();
  }

  /* ---------- selection (lasso) ---------- */
  function lassoSelect(pi, idx, poly) {
    const pg = note.pages[pi];
    const items = new Set();
    if (poly.length > 2) {
      for (const it of pg.items) {
        const r = itemRect(pi, it);
        if (Ink.pointInPoly((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, poly)) items.add(it.id);
      }
    }
    if (!idx.length && !items.size) { clearSel(); return; }
    sel = { pi, strokes: new Set(idx), items };
    renderPage(pi);
  }
  function clearSel() {
    if (!sel) return;
    const pi = sel.pi;
    sel = null;
    if (sheetEl(pi)) renderPage(pi);
  }
  function selBounds() {
    if (!sel) return null;
    const pg = note.pages[sel.pi];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pg.strokes.forEach((st, i) => {
      if (!sel.strokes.has(i)) return;
      const b = Ink.boundsOf([st]);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    });
    for (const it of pg.items) {
      if (!sel.items.has(it.id)) continue;
      const r = itemRect(sel.pi, it);
      x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
    }
    return x0 > x1 ? null : { x0: x0 - 10, y0: y0 - 10, x1: x1 + 10, y1: y1 + 10 };
  }
  function drawSelection(pi) {
    const sh = sheetEl(pi);
    if (!sh || !sel || sel.pi !== pi) return;
    $$('.selbox, .selbar', sh).forEach(x => x.remove());
    const b = selBounds();
    if (!b) return;
    const box = document.createElement('div');
    box.className = 'selbox';
    Object.assign(box.style, { left: b.x0 + 'px', top: b.y0 + 'px', width: (b.x1 - b.x0) + 'px', height: (b.y1 - b.y0) + 'px' });
    sh.appendChild(box);
    const bar = document.createElement('div');
    bar.className = 'selbar';
    bar.style.left = b.x0 + 'px';
    bar.style.top = Math.max(0, b.y0 - 46) + 'px';
    const btn = (label, fn, cls) => {
      const x = document.createElement('button');
      x.textContent = label; if (cls) x.className = cls;
      x.addEventListener('pointerdown', e => e.stopPropagation());
      x.addEventListener('click', e => { e.stopPropagation(); fn(); });
      bar.appendChild(x);
    };
    if (sel.strokes.size) btn('⇄ Convert', () => convertSel());
    if (sel.strokes.size) btn('Smooth', () => { Ink.smooth(note.pages[pi], sel.strokes); renderPage(pi); commit(); });
    btn('Delete', () => {
      const pg = note.pages[pi];
      pg.strokes = pg.strokes.filter((_, i) => !sel.strokes.has(i));
      pg.items = pg.items.filter(it => !sel.items.has(it.id));
      sel = null; renderPage(pi); commit();
    }, 'danger');
    btn('✕', () => clearSel());
    sh.appendChild(bar);
  }
  function insideSel(e) {
    if (!sel) return false;
    const sh = sheetEl(sel.pi), b = selBounds();
    if (!sh || !b) return false;
    const [x, y] = toPage(sel.pi, e.clientX, e.clientY);
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  }
  /** Drag the selection: preview with transforms, then move the data on release. */
  function moveSelPreview(dx, dy) {
    const sh = sheetEl(sel.pi);
    const t = 'translate(' + dx + 'px,' + dy + 'px)';
    $$('path.sel', sh).forEach(p => p.setAttribute('transform', 'translate(' + dx + ' ' + dy + ')'));
    $$('.item.picked, .selbox, .selbar', sh).forEach(x => { x.style.transform = t; });
  }
  function moveSelCommit(dx, dy) {
    const pg = note.pages[sel.pi];
    pg.strokes = pg.strokes.map((st, i) => sel.strokes.has(i)
      ? Object.assign({}, st, { p: st.p.map(q => [+(q[0] + dx).toFixed(1), +(q[1] + dy).toFixed(1), q[2], q[3] || 0]) }) : st);
    for (const it of pg.items) if (sel.items.has(it.id)) { it.x = Math.max(0, it.x + dx); it.y = Math.max(0, it.y + dy); }
    renderPage(sel.pi);
    commit();
  }

  /* ---------------- mode switch (Text ⇄ Math) ---------------- */
  function setModeUI(m) { $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === m)); }
  function setMode(m) {
    setPref('mode', m);
    setModeUI(m);
    if (editing && (m === 'text' || m === 'math')) switchItemType(m);
  }

  /* ---------------- bars ---------------- */
  const MATH_KEYS = [
    ['a⁄b', '()/()', 4], ['xⁿ', '^()', 1], ['xₙ', '_()', 1], ['√', 'sqrt()', 1], ['ⁿ√', 'root()()', 3],
    ['∫', 'int_()^() ', 6], ['∑', 'sum_(n=1)^N ', 0], ['∏', 'prod_(n=1)^N ', 0], ['lim', 'lim_(x->) ', 2],
    ['d/dx', '(d)/(dx) ', 0], ['∂', 'del ', 0], ['∇', 'grad ', 0], ['∞', 'oo ', 0], ['±', '+- ', 0], ['×', 'xx ', 0], ['·', '* ', 0],
    ['≤', '<= ', 0], ['≥', '>= ', 0], ['≠', '!= ', 0], ['≈', '~~ ', 0], ['→', '-> ', 0], ['°', 'deg ', 0],
    ['α', 'alpha ', 0], ['β', 'beta ', 0], ['γ', 'gamma ', 0], ['δ', 'delta ', 0], ['Δ', 'Delta ', 0], ['ε', 'epsilon ', 0],
    ['θ', 'theta ', 0], ['λ', 'lambda ', 0], ['μ', 'mu ', 0], ['ν', 'nu ', 0], ['π', 'pi ', 0], ['ρ', 'rho ', 0], ['σ', 'sigma ', 0],
    ['τ', 'tau ', 0], ['φ', 'phi ', 0], ['ω', 'omega ', 0], ['Ω', 'Omega ', 0],
    ['v⃗', 'vec ', 0], ['x̂', 'hat ', 0], ['x̄', 'bar ', 0], ['|x|', 'abs()', 1], ['[ ]', '[[,],[,]]', 8], ['( )', '()', 1]
  ];
  function buildMathbar() {
    const bar = $('#mathbar');
    for (const [label, ins, back] of MATH_KEYS) {
      const x = document.createElement('button');
      x.textContent = label;
      x.addEventListener('pointerdown', e => e.preventDefault());
      x.addEventListener('click', () => {
        if (!editing || !editing.ta) return;
        const ta = editing.ta, s = ta.selectionStart, e = ta.selectionEnd;
        let text = ins;
        const sel = ta.value.slice(s, e);
        let caret;
        if (sel && /\(\)/.test(ins)) { // wrap selection in the first ()
          text = ins.replace('()', '(' + sel + ')');
          caret = s + text.length;
        } else caret = s + text.length - back;
        ta.setRangeText(text, s, e, 'end');
        ta.setSelectionRange(caret, caret);
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      });
      bar.appendChild(x);
    }
  }
  function buildPenbar() {
    Ink.tool.color = prefs.inkColor; Ink.tool.size = prefs.inkSize;
    $('#btnFinger').onclick = () => { setPref('fingerDraws', !prefs.fingerDraws); syncTools(); toast(prefs.fingerDraws ? 'One finger writes · two fingers scroll' : (prefs.lock ? 'Fingers: two to move the page' : 'One finger scrolls')); };
    $('#btnLock').onclick = () => { setPref('lock', !prefs.lock); syncTools(); toast(prefs.lock ? 'Page locked: use two fingers to move it' : 'Page unlocked'); };
    const sw = $('#penbar .swatches');
    for (const c of INK_COLORS) {
      const x = document.createElement('button');
      x.className = 'swatch' + (c === prefs.inkColor ? ' on' : '');
      x.style.background = c;
      x.onclick = () => {
        setPref('inkColor', c); Ink.tool.color = c;
        $$('.swatch').forEach(s => s.classList.toggle('on', s === x));
        if (Ink.tool.kind === 'eraser' || Ink.tool.kind === 'lasso') { Ink.tool.kind = 'pen'; syncTools(); }
      };
      sw.appendChild(x);
    }
    Ink.tool.dash = prefs.dash; Ink.tool.shapes = prefs.shapes;
    $$('#penbar .dash').forEach(b => b.onclick = () => { setPref('dash', b.dataset.dash); Ink.tool.dash = prefs.dash; syncTools(); });
    $('#btnShapes').onclick = () => { setPref('shapes', !prefs.shapes); Ink.tool.shapes = prefs.shapes; syncTools();
      toast(prefs.shapes ? 'Shapes on: big lines and shapes straighten. Or hold the pen still at the end of any stroke.' : 'Shapes off — hold the pen still at the end of a stroke to straighten it'); };
    Ink.tool.eraserSize = prefs.eraserSize; Ink.tool.eraserMode = prefs.eraserMode;
    $$('#penbar .tool[data-tool]').forEach(t => t.onclick = () => {
      if (t.dataset.tool === 'eraser' && Ink.tool.kind === 'eraser') { toggleEraserPop(t); return; }
      Ink.tool.kind = t.dataset.tool; syncTools();
      if (t.dataset.tool === 'eraser') toggleEraserPop(t, true);
    });
    buildEraserPop();
    $$('#penbar .size').forEach(t => {
      t.classList.toggle('on', parseFloat(t.dataset.size) === prefs.inkSize);
      t.onclick = () => { setPref('inkSize2', parseFloat(t.dataset.size)); prefs.inkSize = parseFloat(t.dataset.size); Ink.tool.size = prefs.inkSize; $$('#penbar .size').forEach(s => s.classList.toggle('on', s === t)); };
    });
    syncTools();
  }
  const HINTS = { pen: 'Write anywhere on the page', pencil: 'Pencil', hl: 'Highlighter — draws under your writing',
    eraser: 'Eraser — tap it again for size (or hold the S Pen button)', lasso: 'Circle ink or text to select, convert or move' };
  const ERASER_SIZES = [[5, 'XS'], [10, 'S'], [18, 'M'], [30, 'L'], [50, 'XL']];
  function buildEraserPop() {
    const pop = document.createElement('div');
    pop.id = 'eraserPop'; pop.className = 'popover'; pop.hidden = true;
    pop.innerHTML = '<div class="mh">Eraser size</div><div class="row" id="esRow"></div>' +
      '<div class="mh">Erases</div><div class="row" id="emRow"><button data-m="area">Only what it touches</button><button data-m="stroke">Whole strokes</button></div>';
    document.body.appendChild(pop);
    const row = pop.querySelector('#esRow');
    for (const [r, label] of ERASER_SIZES) {
      const b = document.createElement('button');
      b.dataset.r = r;
      b.innerHTML = '<i style="display:inline-block;width:' + Math.max(4, r * 0.6) + 'px;height:' + Math.max(4, r * 0.6) + 'px;border-radius:50%;border:1.5px solid currentColor;vertical-align:middle"></i> ' + label;
      b.onclick = () => { setPref('eraserSize', r); Ink.tool.eraserSize = r; syncEraserPop(); };
      row.appendChild(b);
    }
    $$('#emRow button', pop).forEach(b => b.onclick = () => { setPref('eraserMode', b.dataset.m); Ink.tool.eraserMode = b.dataset.m; syncEraserPop(); });
    syncEraserPop();
    document.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !e.target.closest('#eraserPop') && !e.target.closest('[data-tool=eraser]')) pop.hidden = true;
    }, true);
  }
  function syncEraserPop() {
    $$('#esRow button').forEach(b => b.classList.toggle('on', +b.dataset.r === prefs.eraserSize));
    $$('#emRow button').forEach(b => b.classList.toggle('on', b.dataset.m === prefs.eraserMode));
  }
  function toggleEraserPop(btn, show) {
    const pop = $('#eraserPop');
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 340, r.left)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.right = 'auto';
    pop.hidden = show ? false : !pop.hidden;
  }
  function syncTools() {
    $$('#penbar .tool[data-tool]').forEach(t => t.classList.toggle('on', t.dataset.tool === Ink.tool.kind));
    $$('#penbar .dash').forEach(b => b.classList.toggle('on', b.dataset.dash === prefs.dash));
    $('#btnShapes').classList.toggle('on', prefs.shapes);
    $('#btnFinger').classList.toggle('on', prefs.fingerDraws);
    $('#btnLock').classList.toggle('on', prefs.lock);
    $('#btnLock').disabled = false;
    const fingers = prefs.fingerDraws ? ' · 1 finger writes, 2 scroll' : prefs.lock ? ' · 2 fingers move the page' : ' · fingers scroll';
    $('#inkHint').textContent = (HINTS[Ink.tool.kind] || '') + fingers;
  }
  function showMathbar() { $('#mathbar').hidden = false; }
  function hideBars() { $('#mathbar').hidden = true; }

  /* ---------------- clean up ---------------- */
  function ensureSpell() {
    if (!Cleanup.ready) Cleanup.loadSpell(store.readAsset);
  }

  function cleanUp() {
    if (!note) return;
    finishEdit();
    sel = null;
    ensureSpell();
    const all = [];
    const unknown = new Map();
    let inkN = 0;
    for (const pg of note.pages) {
      for (const b of pg.items) {
        if (b.type === 'text') {
          const r = Cleanup.cleanText(b.src, { userDict, autoMath: prefs.autoMath });
          b.src = r.text;
          all.push(...r.changes);
          for (const [w, s] of r.unknown) unknown.set(w, s);
        } else {
          b.src = b.src.replace(/[ \t]{2,}/g, ' ').trim();
        }
      }
      inkN += Ink.smooth(pg) ? 1 : 0;
    }
    if (note.title) {
      const t = note.title.trim().replace(/\s{2,}/g, ' ');
      const t2 = t ? t[0].toUpperCase() + t.slice(1) : t;
      if (t2 !== note.title) { note.title = t2; $('#title').value = t2; }
    }
    render();
    commit();
    showReport(all, unknown, inkN);
  }

  function showReport(changes, unknown, inkN) {
    const rep = $('#report');
    const items = [];
    const seen = new Map();
    for (const c of changes) {
      const k = c.kind === 'spacing' ? 'spacing' : c.from + '→' + c.to;
      seen.set(k, (seen.get(k) || 0) + 1);
      if (seen.get(k) === 1) items.push(c);
    }
    let h = '<h4>✨ ' + (items.length || inkN ? 'Cleaned up' : 'Already tidy') + '</h4>';
    if (items.length) {
      h += '<div>' + items.map(c => {
        if (c.kind === 'spacing') return '<span class="chg">spacing &amp; punctuation</span>';
        const n = seen.get(c.from + '→' + c.to);
        return '<span class="chg"><s>' + MathText.escapeHtml(c.from) + '</s> → ' + MathText.escapeHtml(c.to) + (n > 1 ? ' ×' + n : '') + '</span>';
      }).join('') + '</div>';
    }
    if (inkN) h += '<div><span class="chg">smoothed the handwriting on ' + inkN + ' page' + (inkN > 1 ? 's' : '') + '</span></div>';
    if (unknown.size) {
      h += '<h4 style="margin-top:10px">Not sure about these</h4><div>';
      for (const [w, sug] of unknown) {
        h += '<span class="unk" data-w="' + MathText.escapeHtml(w) + '"><b>' + MathText.escapeHtml(w) + '</b>' +
          sug.map(s => '<button data-fix="' + MathText.escapeHtml(s) + '">' + MathText.escapeHtml(s) + '</button>').join('') +
          '<button data-add="1">＋ dictionary</button></span>';
      }
      h += '</div>';
    }
    h += '<div class="bar"><button class="pill" id="repUndo">Undo</button><button class="pill primary" id="repOk">OK</button></div>';
    rep.innerHTML = h;
    rep.hidden = false;
    $('#repOk').onclick = () => { rep.hidden = true; };
    $('#repUndo').onclick = () => { rep.hidden = true; undo(); };
    $$('.unk', rep).forEach(span => {
      const w = span.dataset.w;
      span.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.add) {
          userDict.add(w.toLowerCase());
          store.setPref('userDict', JSON.stringify([...userDict]));
        } else {
          const fix = btn.dataset.fix;
          const rep2 = w[0] === w[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
          for (const pg of note.pages) for (const b of pg.items) if (b.type === 'text') b.src = Cleanup.replaceWord(b.src, w, rep2);
          commit();
        }
        span.remove();
        render();
      });
    });
  }

  /* ---------------- input: pen, finger, two fingers ----------------
   * Pen (or mouse): writes anywhere on a page. A quick tap on text edits it.
   * One finger: writes when "Finger writes" is on; otherwise scrolls (or, with 🔒, only taps).
   *   A finger tap on text edits it; on empty space it starts typing there.
   * Two fingers: always scroll and pinch-zoom.
   * Inside a lasso selection, pen or finger drags the selection.
   */
  const touches = new Map();
  let g = null;                 // current gesture
  const ignored = new Set();    // palm rejection: touches ignored while the S Pen is near
  let penDown = false, lastPen = -1e9;
  const PEN_GRACE = 700;
  const PALM_SIZE = 34;
  const isPalm = (e) => (e.width || 0) > PALM_SIZE || (e.height || 0) > PALM_SIZE;
  let suppressClickUntil = 0, suppressTouchClickUntil = 0;
  const NATIVE = 'button, .itembar, .selbar, .modal, #report, label, select, input[type=checkbox], .rmpage, #addPage, textarea, input';

  function cancelTouchGesture() {
    if (g && g.type === 'fdraw' && g.sess) g.sess.cancel();
    touches.forEach((_, id) => ignored.add(id));
    touches.clear();
    if (g && g.type !== 'draw') g = null;
    Ink.stopFling();
  }

  /** Start ink on page pi for event e (after closing any editor / selection). */
  function beginDraw(e, pi) {
    if (editing) finishEdit();
    if (sel) clearSel();
    const sh = sheetEl(pi);
    if (!sh || !sh._ink) return null;
    sh._ink.start(e);
    return sh._ink;
  }

  const eraserDot = () => $('#eraserDot');
  function showEraser(x, y) {
    const d = eraserDot(), sz = 2 * Ink.tool.eraserSize * screenScale();
    d.style.width = d.style.height = sz + 'px';
    d.style.margin = (-sz / 2) + 'px 0 0 ' + (-sz / 2) + 'px';
    d.style.left = x + 'px'; d.style.top = y + 'px';
    d.hidden = false;
  }
  const hideEraser = () => { eraserDot().hidden = true; };

  /** A tap (no drawing) on a page: edit the text under it, or start typing there. */
  function tapAt(e, target) {
    const sh = target.closest && target.closest('.sheet');
    if (!sh) return;
    const pi = +sh.dataset.pi;
    const itemEl = target.closest('.item:not(.editing)');
    if (itemEl) {
      const f = findItem(itemEl.dataset.id);
      const cb = target.closest('.cb');
      if (f && cb) { toggleCheck(f.pi, f.item, +cb.dataset.line); return; }
      startEdit(itemEl.dataset.id);
      return;
    }
    if (editing) { finishEdit(); return; }     // first tap away just closes the editor
    if (sel) { clearSel(); return; }
    const [x, y] = toPage(pi, e.clientX, e.clientY);
    typeAt(pi, x, y);
  }

  /** Is (page) point near existing ink? (a finger tap there is a dot, not typing) */
  function nearInk(pi, x, y) {
    return note.pages[pi].strokes.some(st => st.p.some(q => Math.abs(q[0] - x) < 14 && Math.abs(q[1] - y) < 14));
  }

  function wireGestures() {
    const sc = $('#scroller');
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'pen') lastPen = performance.now(); }, true);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') { penDown = true; lastPen = performance.now(); cancelTouchGesture(); }
    }, true);
    const penUp = (e) => { if (e.pointerType === 'pen') { penDown = false; lastPen = performance.now(); } };
    window.addEventListener('pointerup', penUp, true);
    window.addEventListener('pointercancel', penUp, true);

    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        const penNear = penDown || performance.now() - lastPen < PEN_GRACE || !!(A && A.penNear && A.penNear());
        if (penNear || isPalm(e) || ignored.has(e.pointerId)) {
          ignored.add(e.pointerId);
          suppressTouchClickUntil = Date.now() + 1500;
          if (!e.target.closest(NATIVE)) e.preventDefault();
          return;
        }
      }
      if (e.target.closest(NATIVE)) return;
      Ink.stopFling();
      const sh = e.target.closest('.sheet');
      const pi = sh ? +sh.dataset.pi : -1;
      const isPen = e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.button === 0);
      const base = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, t: e.timeStamp,
        vx: 0, vy: 0, moved: false, target: e.target, pi, e0: e };
      if (isPen) {
        if (touches.size || pi < 0) return;
        e.preventDefault();
        if (insideSel(e)) { g = Object.assign(base, { type: 'move' }); return; }
        const onItem = e.target.closest('.item:not(.editing)');
        const sess = beginDraw(e, pi);
        if (!sess) return;
        g = Object.assign(base, { type: 'draw', sess, onItem: onItem && onItem.dataset.id });
        if (Ink.tool.kind === 'eraser') showEraser(e.clientX, e.clientY);
        return;
      }
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary) { touches.clear(); ignored.clear(); if (g && g.type !== 'draw') g = null; }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        if (pi >= 0 && insideSel(e)) g = Object.assign(base, { type: 'move' });
        else if (prefs.fingerDraws && pi >= 0) g = Object.assign(base, { type: 'fdraw', sess: null });
        else if (prefs.lock) g = Object.assign(base, { type: 'tap' });
        else g = Object.assign(base, { type: 'pan' });
      } else if (touches.size === 2) {
        if (g && g.type === 'fdraw' && g.sess) g.sess.cancel();
        hideEraser();
        const [p1, p2] = [...touches.values()];
        const r = sc.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
        g = { type: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z0: userZoom,
          cx: (sc.scrollLeft + mx) / curZoom, cy: (sc.scrollTop + my) / curZoom };
        suppressClickUntil = Date.now() + 400;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (ignored.has(e.pointerId)) return;
      if (e.pointerType === 'touch' && touches.has(e.pointerId) && (penDown || isPalm(e) || (A && A.penNear && A.penNear()))) { cancelTouchGesture(); return; }
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g) return;
      if (g.type === 'pinch') {
        if (touches.size < 2) return;
        const [p1, p2] = [...touches.values()];
        const r = sc.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
        userZoom = Math.max(0.6, Math.min(4, g.z0 * Math.hypot(p1.x - p2.x, p1.y - p2.y) / g.d0));
        applyZoom();
        sc.scrollLeft = g.cx * curZoom - mx;
        sc.scrollTop = g.cy * curZoom - my;
        return;
      }
      if (e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Math.max(1, e.timeStamp - g.t);
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 6) g.moved = true;
      if (g.type === 'draw') {
        e.preventDefault();
        g.sess.move(e);
        if (Ink.tool.kind === 'eraser') showEraser(e.clientX, e.clientY);
      } else if (g.type === 'fdraw') {
        if (!g.sess && g.moved) { g.sess = beginDraw(g.e0, g.pi); if (!g.sess) { g = null; return; } }
        if (g.sess) { g.sess.move(e); if (Ink.tool.kind === 'eraser') showEraser(e.clientX, e.clientY); }
      } else if (g.type === 'move') {
        const k = pageDim().w / sheetEl(sel.pi).getBoundingClientRect().width;
        moveSelPreview((e.clientX - g.x0) * k, (e.clientY - g.y0) * k);
      } else if (g.type === 'pan') {
        sc.scrollLeft -= dx; sc.scrollTop -= dy;
        g.vx = 0.7 * g.vx + 0.3 * dx / dt; g.vy = 0.7 * g.vy + 0.3 * dy / dt;
      }
      g.x = e.clientX; g.y = e.clientY; g.t = e.timeStamp;
    }, { passive: false });

    const up = (e) => {
      if (ignored.delete(e.pointerId)) { suppressTouchClickUntil = Date.now() + 400; return; }
      const wasTouch = touches.delete(e.pointerId);
      if (!g) return;
      if (g.type === 'pinch') { if (!touches.size) g = null; return; }
      if (e.pointerId !== g.id) return;
      const cur = g; g = null;
      hideEraser();
      const isTap = !cur.moved && e.type === 'pointerup' && e.timeStamp - cur.t0 < 400;
      if (cur.type === 'move') {
        if (cur.moved) {
          const k = pageDim().w / sheetEl(sel.pi).getBoundingClientRect().width;
          moveSelCommit((e.clientX - cur.x0) * k, (e.clientY - cur.y0) * k);
        }
        return;
      }
      if (cur.type === 'draw') {
        if (e.type === 'pointercancel') { cur.sess.cancel(); return; }
        // a quick pen tap on text edits it instead of leaving a dot
        if (isTap && cur.onItem && Ink.tool.kind !== 'eraser' && Ink.tool.kind !== 'lasso') { cur.sess.cancel(); startEdit(cur.onItem); return; }
        cur.sess.end(e);
        return;
      }
      if (cur.type === 'fdraw') {
        if (cur.sess) { cur.sess.end(e); return; }
        if (e.type !== 'pointerup') return;
        const [x, y] = toPage(cur.pi, e.clientX, e.clientY);
        if (!cur.target.closest('.item') && nearInk(cur.pi, x, y) && Ink.tool.kind !== 'lasso') {
          const s2 = beginDraw(cur.e0, cur.pi); if (s2) s2.end(e);     // a dot (the i in "i")
        } else tapAt(e, cur.target);
        return;
      }
      if (cur.moved) {
        suppressClickUntil = Date.now() + 350;
        if (cur.type === 'pan' && Math.abs(cur.vx) + Math.abs(cur.vy) > 0.15) Ink.fling(sc, cur.vx, cur.vy);
        return;
      }
      if (e.type !== 'pointerup' || !wasTouch) return;
      tapAt(e, cur.target);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('click', (e) => {
      const blocked = Date.now() < suppressClickUntil || (e.pointerType === 'touch' && Date.now() < suppressTouchClickUntil);
      if (blocked && e.target.closest('#scroller, #toolbar, #penbar')) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      userZoom = Math.max(0.6, Math.min(4, userZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      applyZoom();
    }, { passive: false });
    window.addEventListener('resize', () => { applyZoom(); if (editing && editing.ta) autoGrow(editing.ta); });
  }

  /* ---------------- convert handwriting ---------------- */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function setBusy(on, label) {
    $('#btnConvert').classList.toggle('busy', on);
    $('#btnConvert').innerHTML = on ? (label || 'Reading…') : '⇄<span class="lbl"> Convert</span>';
  }

  async function ensureModel() {
    if (window.InkRecMock) return true;
    let st = InkRec.status();
    for (let i = 0; i < 10 && st === 'checking'; i++) { await sleep(300); st = InkRec.status(); }
    if (st === 'ready') return true;
    if (st === 'unavailable') { toast("Handwriting recognition isn't available on this device"); return false; }
    if (st === 'downloading') { toast('The handwriting model is still downloading…'); return false; }
    if (!(await ask('Converting handwriting needs Google\'s on-device handwriting model (about 20 MB, one-time download). After that it works offline. Download it now?', 'Download'))) return false;
    setBusy(true, 'Downloading…');
    try { await InkRec.download(); toast('Handwriting model ready'); return true; }
    catch (e) { toast(e.message); return false; }
    finally { setBusy(false); }
  }

  let cv = null;   // {pi, idx:Set, box, items:[{type,src,alts,strokes}]}
  const copyStrokes = (list) => list.map(st => ({ c: st.c, s: st.s, k: st.k, p: st.p.map(q => q.slice()) }));

  async function convertSel() {
    if (!sel || !sel.strokes.size) { toast('Lasso some handwriting first'); return; }
    const pi = sel.pi, idx = new Set(sel.strokes), pg = note.pages[pi];
    const strokes = pg.strokes.filter((st, i) => idx.has(i) && st.k !== 'hl');
    if (!strokes.length) { toast('Nothing to convert'); return; }
    const box = Ink.boundsOf(strokes);
    if (!(await ensureModel())) return;
    setBusy(true);
    try {
      const res = await InkRec.convert(copyStrokes(strokes), prefs.mode);
      if (!res.length) { toast('Couldn\'t read that'); return; }
      ensureSpell();
      res.forEach(r => {
        if (r.type === 'text') { r.src = Cleanup.cleanText(applyCorrections(r.src), { userDict, autoMath: prefs.autoMath }).text; r.orig = r.src; }
      });
      cv = { pi, idx, box, items: res };
      renderConvert();
      $('#convert').hidden = false;
    } catch (e) {
      toast('Recognition failed: ' + e.message);
    } finally { setBusy(false); }
  }

  function renderConvert() {
    const body = $('#cvBody');
    body.innerHTML = '';
    cv.items.forEach((it, k) => {
      const box = document.createElement('div');
      box.className = 'cv';
      box.innerHTML = '<div class="cvhead"><div class="seg"><button data-t="text">Aa Text</button><button data-t="math">∑ Math</button></div>' +
        '<span class="grow"></span><button class="pill" data-rm="1">Remove</button></div><textarea rows="1"></textarea><div class="pv"></div><div class="alts"></div>';
      const ta = box.querySelector('textarea'), pv = box.querySelector('.pv');
      ta.value = it.src;
      ta.classList.toggle('mono', it.type === 'math');
      $$('.seg button', box).forEach(btn => {
        btn.classList.toggle('on', btn.dataset.t === it.type);
        btn.onclick = async () => {
          if (btn.dataset.t === it.type) return;
          const want = btn.dataset.t;
          box.classList.add('busy');
          try {
            const again = it.strokes ? await InkRec.convert(it.strokes, want) : [];
            it.src = again.length ? again.map(r => r.src).join(want === 'text' ? '\n' : ' ') : it.src;
            if (want === 'text') it.src = Cleanup.cleanText(it.src, { userDict, autoMath: prefs.autoMath }).text;
          } catch (e) { toast(e.message); }
          it.type = want;
          renderConvert();
        };
      });
      box.querySelector('[data-rm]').onclick = () => { cv.items.splice(k, 1); renderConvert(); };
      const upd = () => {
        it.src = ta.value;
        autoGrow(ta);
        if (it.type === 'math') { pv.className = 'pv'; pv.innerHTML = MathText.renderMath(it.src, true).html; }
        else { pv.className = 'pv hand'; pv.innerHTML = MathText.renderText(it.src, { autoMath: prefs.autoMath }); }
      };
      ta.addEventListener('input', upd);
      const alts = box.querySelector('.alts');
      (it.alts || []).filter(a => a && a !== it.src).slice(0, 4).forEach(a => {
        const x = document.createElement('button');
        x.textContent = a;
        x.onclick = () => { ta.value = it.type === 'text' ? Cleanup.cleanText(a, { userDict, autoMath: prefs.autoMath }).text : a; upd(); };
        alts.appendChild(x);
      });
      body.appendChild(box);
      requestAnimationFrame(upd);
    });
    if (!cv.items.length) body.innerHTML = '<p style="color:#7a7466">Nothing left to insert.</p>';
  }

  function closeConvert() { $('#convert').hidden = true; cv = null; }

  function insertConverted() {
    if (!cv) return;
    const pg = note.pages[cv.pi];
    const keep = $('#cvKeep').checked;
    const L = lineH(), d = pageDim();
    // the result goes where the handwriting was, lined up with the ruling
    let x = Math.max(8, Math.round(cv.box.x0));
    let y = Math.max(0, Math.round(cv.box.y0 / L) * L);
    for (const it of cv.items) {
      if (!it.src.trim()) continue;
      if (it.type === 'text' && it.orig) learnCorrections(it.orig, it.src);
      const item = { id: uid(), type: it.type, x, y, w: Math.max(160, d.w - MARGIN.r - x), src: it.type === 'math' ? it.src.trim() : it.src };
      pg.items.push(item);
      y += it.type === 'math' ? 3 * L : it.src.split('\n').length * L;
    }
    if (!keep) pg.strokes = pg.strokes.filter((_, i) => !cv.idx.has(i));
    sel = null;
    const pi = cv.pi;
    closeConvert();
    renderPage(pi);
    commit();
    if (Ink.tool.kind === 'lasso') { Ink.tool.kind = 'pen'; syncTools(); }
  }

  /* ---------------- handwriting training ---------------- */
  let tr = null;
  function openTrain() {
    closeMenu();
    finishEdit();
    const k = Train.SYMBOLS.findIndex(([s]) => Train.count(s) < 3);
    tr = { i: k < 0 ? 0 : k, savedTool: Ink.tool.kind, savedSize: Ink.tool.size };
    Ink.tool.kind = 'pen'; Ink.tool.size = 3;
    $('#train').hidden = false;
    showTrain();
  }
  function closeTrain() {
    if (!tr) return;
    Ink.tool.kind = tr.savedTool; Ink.tool.size = tr.savedSize;
    tr = null;
    $('#train').hidden = true;
  }
  function showTrain() {
    const [sym, tok] = Train.SYMBOLS[tr.i];
    $('#trPrompt').innerHTML = /^[A-Za-z0-9()<>+=]$/.test(sym) ? '<span style="font-family:var(--hand)">' + MathText.escapeHtml(sym) + '</span>'
      : MathText.renderMath(tok, false).html;
    const n = Train.count(sym);
    $('#trInfo').textContent = 'Write “' + sym + '”  ·  ' + n + ' of 3 samples' + (n >= 3 ? ' ✓ (more is fine)' : '');
    const svg = $('#trPad');
    tr.block = { strokes: [], w: 600, h: 300 };
    Ink.render(svg, tr.block);
    tr.sess = Ink.session(svg, tr.block, {});
    const chips = $('#trChips');
    chips.innerHTML = '';
    Train.SYMBOLS.forEach(([s], k) => {
      const b = document.createElement('button');
      const c = Train.count(s);
      b.className = (c >= 3 ? 'done' : '') + (k === tr.i ? ' on' : '');
      b.innerHTML = MathText.escapeHtml(s) + (c ? '<sup>' + c + '</sup>' : '');
      b.onclick = () => { tr.i = k; showTrain(); };
      chips.appendChild(b);
    });
  }
  function wireTrain() {
    const svg = $('#trPad');
    let active = null;
    svg.addEventListener('pointerdown', (e) => {
      if (!tr || active !== null) return;
      e.preventDefault();
      active = e.pointerId;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { }
      tr.sess.start(e);
    });
    svg.addEventListener('pointermove', (e) => { if (tr && e.pointerId === active) { e.preventDefault(); tr.sess.move(e); } });
    const end = (e) => { if (tr && e.pointerId === active) { active = null; tr.sess.end(e); } };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    $('#trClear').onclick = () => showTrain();
    $('#trSkip').onclick = () => { tr.i = (tr.i + 1) % Train.SYMBOLS.length; showTrain(); };
    $('#trSave').onclick = () => {
      if (!tr.block.strokes.length) { toast('Write the symbol first'); return; }
      const sym = Train.SYMBOLS[tr.i][0];
      Train.addSample(sym, tr.block.strokes);
      if (Train.count(sym) >= 3) {
        const next = Train.SYMBOLS.findIndex(([s], k) => k > tr.i && Train.count(s) < 3);
        tr.i = next < 0 ? (tr.i + 1) % Train.SYMBOLS.length : next;
      }
      showTrain();
    };
    $('#trDone').onclick = closeTrain;
    $('#trReset').onclick = async () => {
      if (await ask('Delete all your handwriting samples?', 'Delete')) { Train.clear(); showTrain(); }
    };
  }

  /* ---------------- learning from corrections ---------------- */
  let corrections = {};
  try { corrections = JSON.parse(store.getPref('corrections') || '{}') || {}; } catch (e) { }
  const wordKey = (w) => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  function applyCorrections(text) {
    if (!text) return text;
    return text.replace(/[A-Za-z][A-Za-z']*/g, (w) => {
      const c = corrections[w.toLowerCase()];
      if (!c) return w;
      return w[0] === w[0].toUpperCase() && c[0] === c[0].toLowerCase() ? c[0].toUpperCase() + c.slice(1) : c;
    });
  }
  function learnCorrections(before, after) {
    const a = (before || '').split(/\s+/).filter(Boolean), b = (after || '').split(/\s+/).filter(Boolean);
    if (!a.length || a.length !== b.length) return;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const x = wordKey(a[i]), y = b[i].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, '');
      if (!x || !y || x === y.toLowerCase() || !/^[a-z']+$/.test(x) || !/^[A-Za-z']+$/.test(y)) continue;
      if (Math.abs(x.length - y.length) > 3) continue;
      // a capital only at the first letter is usually just sentence position — store it lowercase
      corrections[x] = /^[A-Z][a-z']+$/.test(y) ? y.toLowerCase() : y; n++;
    }
    if (n) {
      const keys = Object.keys(corrections);
      if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete corrections[k]);
      store.setPref('corrections', JSON.stringify(corrections));
    }
  }

  /* ---------------- export ---------------- */
  function toMarkdown() {
    const out = ['# ' + (note.title || 'Untitled'), ''];
    note.pages.forEach((pg, pi) => {
      for (const b of pg.items.slice().sort((a, c) => a.y - c.y || a.x - c.x)) {
        if (b.type === 'text') out.push(MathText.textToLatexMarkdown(b.src, prefs.autoMath), '');
        else out.push('$$' + MathText.toTeX(b.src) + '$$', '');
      }
      if (pg.strokes.length) out.push('[handwriting on page ' + (pi + 1) + ']', '');
    });
    return out.join('\n').trim() + '\n';
  }

  function backupAll() {
    saveNow();
    const notes = store.ids().map(id => { try { return JSON.parse(store.load(id)); } catch (e) { return null; } }).filter(Boolean);
    const json = JSON.stringify({ app: 'InkNotes', version: 1, exported: new Date().toISOString(), userDict: [...userDict], notes });
    const name = 'InkNotes-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    if (A) A.saveBackup(name, json);
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name; a.click(); }
  }

  function restoreFrom(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        if (!data || !Array.isArray(data.notes)) throw new Error('not an InkNotes backup');
        let n = 0;
        for (const nt of data.notes) {
          if (!nt || !nt.id || !/^[A-Za-z0-9_\-]{1,80}$/.test(nt.id)) continue;
          let existing = null;
          try { existing = JSON.parse(store.load(nt.id) || 'null'); } catch (e) { }
          if (existing && (existing.updated || 0) > (nt.updated || 0)) continue;
          store.save(nt.id, JSON.stringify(nt)); n++;
        }
        (data.userDict || []).forEach(w => userDict.add(String(w).toLowerCase()));
        store.setPref('userDict', JSON.stringify([...userDict]));
        loadIndex(); renderList();
        if (note) openNote(note.id);
        toast('Restored ' + n + ' note' + (n === 1 ? '' : 's'));
      } catch (e) { toast('Restore failed: ' + e.message); }
    };
    fr.readAsText(file);
  }

  /* ---------------- confirm dialog ---------------- */
  function ask(msg, okLabel) {
    return new Promise(res => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = '<div class="card" style="max-width:420px"><p style="font-size:16px"></p><div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="pill" data-v="0">Cancel</button><button class="pill primary" data-v="1"></button></div></div>';
      m.querySelector('p').textContent = msg;
      m.querySelector('[data-v="1"]').textContent = okLabel || 'OK';
      m.addEventListener('click', e => { const b = e.target.closest('button'); if (!b && e.target !== m) return; m.remove(); res(b ? b.dataset.v === '1' : false); });
      document.body.appendChild(m);
    });
  }

  /* ---------------- menu ---------------- */
  function buildMenu() {
    const fr = $('#fontRow');
    for (const [k, fam, label] of FONTS) {
      const x = document.createElement('button');
      x.textContent = label; x.style.fontFamily = fam; x.style.fontSize = '20px';
      x.classList.toggle('on', prefs.font === k);
      x.onclick = () => { setPref('font', k); applyBodyClasses(); $$('#fontRow button').forEach(y => y.classList.toggle('on', y === x)); render(); };
      fr.appendChild(x);
    }
    const pr = $('#paperRow');
    for (const [k, label] of PAPERS) {
      const x = document.createElement('button');
      x.textContent = label; x.dataset.p = k;
      x.onclick = () => {
        note.paper = k; setPref('paper', k);
        $$('.sheet', pagesEl).forEach(sh => { sh.classList.remove('paper-lined', 'paper-grid', 'paper-dot', 'paper-plain'); sh.classList.add('paper-' + k); });
        $$('#paperRow button').forEach(y => y.classList.toggle('on', y === x));
        commit();
      };
      pr.appendChild(x);
    }
    const sr = $('#sizeRow');
    for (const k of Object.keys(SIZES)) {
      const x = document.createElement('button');
      x.textContent = SIZES[k].label; x.dataset.s = k;
      x.onclick = () => {
        finishEdit();
        note.size = k; setPref('size', k);
        $$('#sizeRow button').forEach(y => y.classList.toggle('on', y === x));
        applyZoom(); render(); commit();
      };
      sr.appendChild(x);
    }
    $$('#tsizeRow button').forEach(x => {
      x.classList.toggle('on', x.dataset.t === prefs.textSize);
      x.onclick = () => {
        finishEdit();
        setPref('textSize', x.dataset.t);
        $$('#tsizeRow button').forEach(y => y.classList.toggle('on', y === x));
        applyBodyClasses();
        render();
      };
    });
    $$('#zoomRow button').forEach(x => x.onclick = () => {
      const z = x.dataset.z;
      userZoom = z === 'fit' ? 1 : Math.max(0.6, Math.min(4, userZoom * (z === 'in' ? 1.25 : 0.8)));
      applyZoom();
    });
    const bind = (id, key, after) => {
      const c = $(id); c.checked = prefs[key];
      c.onchange = () => { setPref(key, c.checked); applyBodyClasses(); after && after(); };
    };
    bind('#optHandMath', 'handMath', () => render());
    bind('#optAutoMath', 'autoMath', () => render());
    $('#miPdf').onclick = () => { closeMenu(); finishEdit(); saveNow(); setTimeout(() => A ? A.printPdf(note.title || 'InkNotes', note.size || 'letter') : window.print(), 150); };
    $('#miShare').onclick = () => { closeMenu(); finishEdit(); const md = toMarkdown(); if (A) A.shareText(note.title || 'Note', md); else console.log(md); };
    $('#miHelp').onclick = () => { closeMenu(); openHelp(); };
    $('#miTrain').onclick = () => openTrain();
    $('#miDelete').onclick = async () => {
      closeMenu();
      if (!(await ask('Delete “' + (note.title || 'Untitled') + '”? This can\'t be undone.', 'Delete'))) return;
      store.remove(note.id);
      editing = null; sel = null;
      note = null;
      loadIndex();
      if (index.length) openNote(index[0].id); else newNote();
      renderList();
    };
  }
  function openMenu() {
    $$('#paperRow button').forEach(y => y.classList.toggle('on', y.dataset.p === (note.paper || prefs.paper)));
    $$('#sizeRow button').forEach(y => y.classList.toggle('on', y.dataset.s === (note.size || prefs.size)));
    $('#menu').hidden = false;
  }
  function closeMenu() { $('#menu').hidden = true; }

  function openHelp() {
    $$('#help .ex').forEach(td => { td.innerHTML = MathText.renderMath(td.dataset.am, false).html; });
    $('#help').hidden = false;
  }

  /* ---------------- welcome note ---------------- */
  function welcome() {
    const L = lineH(), x = MARGIN.l, w = pageDim().w - MARGIN.l - MARGIN.r;
    const t = (y, src) => ({ id: uid(), type: 'text', x, y: y * L, w, src });
    const pg = newPageObj();
    pg.items = [
      t(4, '# Write anywhere\nWrite anywhere on the page with the S Pen or your finger — over text too. Tap empty space to type. To turn handwriting into neat text or a formula, circle it with ◌ Lasso and tap ⇄ Convert.'),
      t(10, '# Pen tools\n- Solid, dashed and dotted lines\n- 📐 Shapes straightens lines and shapes; or hold the pen still at the end of a stroke\n- Hold the S Pen side button to erase; tap ⌫ Eraser twice for its size\n- ◌ Lasso ink or text, then drag it to move it'),
      t(17, '# Fingers\n- ☝️ Finger writes: one finger writes, two fingers scroll and zoom\n- 🔒 Lock: only two fingers move the page'),
      { id: uid(), type: 'math', x: x + 120, y: 22 * L, w, src: 'int_0^oo e^(-x^2) dx = sqrt(pi)/2' }
    ];
    return newNote([pg], 'Welcome to InkNotes');
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $$('#modeSeg button').forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
    $$('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('#btnConvert').addEventListener('pointerdown', e => e.preventDefault());
    $('#btnConvert').onclick = () => {
      if (sel && sel.strokes.size) return convertSel();
      Ink.tool.kind = 'lasso'; syncTools();
      toast('Circle the handwriting with the lasso, then tap Convert');
    };
    $('#cvCancel').onclick = () => closeConvert();
    $('#cvInsert').onclick = () => insertConverted();
    $('#btnClean').addEventListener('pointerdown', e => e.preventDefault());
    $('#btnClean').onclick = cleanUp;
    $('#btnUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnMore').onclick = (e) => { e.stopPropagation(); $('#menu').hidden ? openMenu() : closeMenu(); };
    $('#btnMenu').onclick = () => {
      if (window.innerWidth >= 1100) {
        const c = !document.body.classList.contains('sidecollapsed');
        document.body.classList.toggle('sidecollapsed', c);
        store.setPref('sideCollapsed', c ? '1' : '0');
        setTimeout(() => { applyZoom(); }, 220);
      } else document.body.classList.toggle('drawer');
    };
    document.body.classList.toggle('sidecollapsed', store.getPref('sideCollapsed') === '1');
    $('#scrim').onclick = () => document.body.classList.remove('drawer');
    $('#btnNew').onclick = () => { document.body.classList.remove('drawer'); newNote(); $('#title').focus(); };
    $('#search').oninput = renderList;
    $('#btnBackup').onclick = backupAll;
    $('#restoreFile').onchange = (e) => { const f = e.target.files[0]; if (f) restoreFrom(f); e.target.value = ''; };
    $('#helpClose').onclick = () => { $('#help').hidden = true; };
    $('#help').onclick = (e) => { if (e.target.id === 'help') $('#help').hidden = true; };
    $('#title').addEventListener('input', () => { note.title = $('#title').value; scheduleSave(); });
    $('#title').addEventListener('change', commit);
    $('#title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        typeAt(0, MARGIN.l, 4 * lineH());
      }
    });
    wireGestures();
    document.addEventListener('pointerdown', (e) => {
      if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMore')) closeMenu();
    }, true);
  }

  /* S Pen side button: Android hands us the points (Chrome would otherwise treat it as text selection) */
  let eraseTouched = null;
  function penErase(pts, phase) {
    if (phase === 'start') { finishEdit(); clearSel(); eraseTouched = new Map(); }
    if (!eraseTouched) eraseTouched = new Map();
    for (const [x, y] of pts) {
      showEraser(x, y);
      const el = document.elementFromPoint(x, y);
      const sh = el && el.closest && el.closest('.sheet');
      if (!sh || !sh._ink) continue;
      const pi = +sh.dataset.pi;
      const first = !eraseTouched.has(pi);
      if (first) eraseTouched.set(pi, false);
      if (sh._ink.eraseClient(x, y, first)) eraseTouched.set(pi, true);
    }
    if (phase === 'end' || phase === 'cancel') {
      hideEraser();
      if ([...eraseTouched.values()].some(Boolean)) commit();
      eraseTouched = null;
    }
    return true;
  }

  window.InkNotes = {
    penErase,
    onBack() {
      if (!$('#train').hidden) { closeTrain(); return true; }
      if (!$('#convert').hidden) { closeConvert(); return true; }
      if (!$('#help').hidden) { $('#help').hidden = true; return true; }
      if (sel) { clearSel(); return true; }
      if (!$('#menu').hidden) { closeMenu(); return true; }
      if (!$('#report').hidden) { $('#report').hidden = true; return true; }
      if (editing) { finishEdit(); return true; }
      if (document.body.classList.contains('drawer')) { document.body.classList.remove('drawer'); return true; }
      return false;
    },
    flush() { if (editing) commit(); saveNow(); },
    _debug: { get note() { return note; }, get sel() { return sel; }, cleanUp, setMode, startEdit, finishEdit, typeAt, convertSel, render }
  };

  /* ---------------- boot ---------------- */
  applyBodyClasses();
  buildMathbar();
  Train.init(store);
  buildPenbar();
  wireTrain();
  buildMenu();
  wire();
  setModeUI(prefs.mode);
  loadIndex();
  const start = () => {
    if (prefs.lastNote && index.some(i => i.id === prefs.lastNote)) openNote(prefs.lastNote);
    else if (index.length) openNote(index[0].id);
    else welcome();
  };
  // wait for handwriting fonts so the first paint is already pretty
  (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('31px Caveat'), document.fonts.load('23px Kalam'),
    document.fonts.load('26px "Patrick Hand"'), document.fonts.load('26px "Shadows Into Light"')]).catch(() => { }) : Promise.resolve())
    .then(start);
  // load the dictionary when idle so misspellings get underlined
  setTimeout(() => { ensureSpell(); if (note && !editing && !g) render(); }, 1200);
})();
